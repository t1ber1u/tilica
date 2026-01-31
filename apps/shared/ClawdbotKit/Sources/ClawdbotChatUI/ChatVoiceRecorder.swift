import Foundation
import Observation
import SwiftUI

#if canImport(Speech) && canImport(AVFoundation)
import AVFoundation
import Speech
#endif

#if canImport(AppKit)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

/// State for the voice recording session
public enum ChatVoiceState: Equatable, Sendable {
    case idle
    case requesting     // Requesting permissions
    case listening      // Actively listening
    case transcribing   // Finalizing transcription
    case error(String)  // Error occurred
}

/// Observable voice recorder for chat UI
@MainActor
@Observable
public final class ChatVoiceRecorder {
    public private(set) var state: ChatVoiceState = .idle
    public private(set) var transcript: String = ""
    public private(set) var partialTranscript: String = ""
    public private(set) var audioLevel: Float = 0

    #if canImport(Speech) && canImport(AVFoundation)
    private var recognizer: SFSpeechRecognizer?
    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var tapInstalled = false
    #endif

    private var levelTimer: Timer?

    public var localeIdentifier: String = "ro-RO" // Romanian default

    public init() {}

    deinit {
        self.cleanup()
    }

    public var isRecording: Bool {
        self.state == .listening
    }

    /// Start voice recording and transcription
    public func start() async {
        #if canImport(Speech) && canImport(AVFoundation)
        guard self.state == .idle || self.state == .error("") else { return }

        self.state = .requesting
        self.transcript = ""
        self.partialTranscript = ""
        self.audioLevel = 0

        // Check permissions
        let speechStatus = SFSpeechRecognizer.authorizationStatus()
        if speechStatus == .notDetermined {
            let granted = await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { status in
                    continuation.resume(returning: status == .authorized)
                }
            }
            if !granted {
                self.state = .error("Speech recognition permission denied")
                return
            }
        } else if speechStatus != .authorized {
            self.state = .error("Speech recognition permission denied")
            return
        }

        // Check microphone permission
        let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
        if micStatus == .notDetermined {
            let granted = await AVCaptureDevice.requestAccess(for: .audio)
            if !granted {
                self.state = .error("Microphone permission denied")
                return
            }
        } else if micStatus != .authorized {
            self.state = .error("Microphone permission denied")
            return
        }

        do {
            try await self.startRecognition()
            self.state = .listening
            self.startLevelMonitoring()
        } catch {
            self.state = .error(error.localizedDescription)
        }
        #else
        self.state = .error("Voice recording not available on this platform")
        #endif
    }

    /// Stop recording and finalize transcription
    public func stop() {
        guard self.state == .listening else { return }

        self.state = .transcribing
        self.stopLevelMonitoring()

        #if canImport(Speech) && canImport(AVFoundation)
        // Stop audio input
        if self.tapInstalled {
            self.audioEngine?.inputNode.removeTap(onBus: 0)
            self.tapInstalled = false
        }
        self.recognitionRequest?.endAudio()
        #endif

        // Give recognizer time to finalize
        Task {
            try? await Task.sleep(nanoseconds: 500_000_000)
            await MainActor.run {
                self.finalizeTranscription()
            }
        }
    }

    /// Cancel recording without transcription
    public func cancel() {
        self.cleanup()
        self.state = .idle
        self.transcript = ""
        self.partialTranscript = ""
        self.audioLevel = 0
    }

    /// Reset to idle state
    public func reset() {
        self.cleanup()
        self.state = .idle
        self.transcript = ""
        self.partialTranscript = ""
        self.audioLevel = 0
    }

    // MARK: - Private

    #if canImport(Speech) && canImport(AVFoundation)
    private func startRecognition() async throws {
        let locale = Locale(identifier: self.localeIdentifier)
        self.recognizer = SFSpeechRecognizer(locale: locale)

        guard let recognizer = self.recognizer, recognizer.isAvailable else {
            throw NSError(
                domain: "ChatVoiceRecorder",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Speech recognizer unavailable for \(locale.identifier)"])
        }

        self.recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        self.recognitionRequest?.shouldReportPartialResults = true

        guard let request = self.recognitionRequest else {
            throw NSError(
                domain: "ChatVoiceRecorder",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Failed to create recognition request"])
        }

        // Create audio engine
        self.audioEngine = AVAudioEngine()
        guard let audioEngine = self.audioEngine else { return }

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)

        // Install tap to capture audio
        if self.tapInstalled {
            input.removeTap(onBus: 0)
            self.tapInstalled = false
        }

        input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak request] buffer, _ in
            request?.append(buffer)
        }
        self.tapInstalled = true

        audioEngine.prepare()
        try audioEngine.start()

        // Start recognition task
        self.recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }

            if let error = error {
                Task { @MainActor in
                    if self.state == .listening {
                        self.state = .error(error.localizedDescription)
                    }
                }
                return
            }

            guard let result = result else { return }
            let text = result.bestTranscription.formattedString
            let isFinal = result.isFinal

            Task { @MainActor in
                if isFinal {
                    self.transcript = text
                    self.partialTranscript = ""
                } else {
                    self.partialTranscript = text
                }
            }
        }
    }
    #endif

    private func finalizeTranscription() {
        // Use partial transcript if final wasn't received
        if self.transcript.isEmpty && !self.partialTranscript.isEmpty {
            self.transcript = self.partialTranscript
        }
        self.partialTranscript = ""
        self.cleanup()
        self.state = .idle
    }

    private func startLevelMonitoring() {
        self.levelTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            Task { @MainActor in
                self.updateAudioLevel()
            }
        }
    }

    private func stopLevelMonitoring() {
        self.levelTimer?.invalidate()
        self.levelTimer = nil
        self.audioLevel = 0
    }

    private func updateAudioLevel() {
        #if canImport(Speech) && canImport(AVFoundation)
        guard let audioEngine = self.audioEngine, audioEngine.isRunning else {
            self.audioLevel = 0
            return
        }

        // Simulate audio level based on engine running state
        let baseLevel: Float = 0.3
        let variation = Float.random(in: -0.2...0.3)
        self.audioLevel = min(1.0, max(0.0, baseLevel + variation))
        #else
        self.audioLevel = 0
        #endif
    }

    private func cleanup() {
        self.stopLevelMonitoring()

        #if canImport(Speech) && canImport(AVFoundation)
        self.recognitionTask?.cancel()
        self.recognitionTask = nil
        self.recognitionRequest = nil

        if self.tapInstalled {
            self.audioEngine?.inputNode.removeTap(onBus: 0)
            self.tapInstalled = false
        }

        if self.audioEngine?.isRunning == true {
            self.audioEngine?.stop()
            self.audioEngine?.reset()
        }
        self.audioEngine = nil
        self.recognizer = nil
        #endif
    }
}

/// Visual waveform animation for voice recording
public struct ChatVoiceWaveform: View {
    public let audioLevel: Float
    public let isRecording: Bool

    @State private var phase: Double = 0

    private let barCount = 5

    public init(audioLevel: Float, isRecording: Bool) {
        self.audioLevel = audioLevel
        self.isRecording = isRecording
    }

    public var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<self.barCount, id: \.self) { index in
                self.bar(at: index)
            }
        }
        .frame(height: 24)
        .onChange(of: self.isRecording) { _, recording in
            if recording {
                self.startAnimation()
            }
        }
        .onAppear {
            if self.isRecording {
                self.startAnimation()
            }
        }
    }

    private func bar(at index: Int) -> some View {
        let baseHeight: CGFloat = 4
        let maxHeight: CGFloat = 20
        let offset = Double(index) * 0.3
        let animatedLevel = self.isRecording
            ? CGFloat(self.audioLevel) * sin(self.phase + offset) * 0.5 + 0.5
            : 0.2
        let height = baseHeight + (maxHeight - baseHeight) * animatedLevel

        return RoundedRectangle(cornerRadius: 2)
            .fill(self.isRecording ? Color.red : Color.secondary)
            .frame(width: 4, height: height)
            .animation(.easeInOut(duration: 0.1), value: height)
    }

    private func startAnimation() {
        withAnimation(.linear(duration: 0.5).repeatForever(autoreverses: false)) {
            self.phase = .pi * 2
        }
    }
}

/// Voice recording button with visual feedback
public struct ChatVoiceButton: View {
    @Bindable public var recorder: ChatVoiceRecorder
    public let onTranscript: (String) -> Void

    public init(recorder: ChatVoiceRecorder, onTranscript: @escaping (String) -> Void) {
        self.recorder = recorder
        self.onTranscript = onTranscript
    }

    public var body: some View {
        Group {
            switch self.recorder.state {
            case .idle:
                self.idleButton
            case .requesting:
                ProgressView()
                    .controlSize(.small)
            case .listening:
                self.recordingButton
            case .transcribing:
                ProgressView()
                    .controlSize(.small)
            case .error(let message):
                self.errorButton(message: message)
            }
        }
    }

    private var idleButton: some View {
        Button {
            Task {
                await self.recorder.start()
            }
        } label: {
            Image(systemName: "mic.fill")
                .font(.system(size: 13, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(.white)
        .padding(6)
        .background(Circle().fill(Color.accentColor.opacity(0.8)))
        .help("Start voice recording (Romanian)")
    }

    private var recordingButton: some View {
        HStack(spacing: 8) {
            ChatVoiceWaveform(
                audioLevel: self.recorder.audioLevel,
                isRecording: true)

            Button {
                self.recorder.stop()
                if !self.recorder.transcript.isEmpty {
                    self.onTranscript(self.recorder.transcript)
                    self.recorder.reset()
                } else {
                    // Wait for transcript to be ready
                    Task {
                        try? await Task.sleep(nanoseconds: 600_000_000)
                        await MainActor.run {
                            if !self.recorder.transcript.isEmpty {
                                self.onTranscript(self.recorder.transcript)
                            }
                            self.recorder.reset()
                        }
                    }
                }
            } label: {
                Image(systemName: "stop.fill")
                    .font(.system(size: 13, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(.white)
            .padding(6)
            .background(Circle().fill(Color.red))
            .help("Stop recording and send")

            Button {
                self.recorder.cancel()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .help("Cancel recording")
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color.red.opacity(0.1))
        .clipShape(Capsule())
    }

    private func errorButton(message: String) -> some View {
        Button {
            self.recorder.reset()
        } label: {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 13, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(.orange)
        .padding(6)
        .background(Circle().fill(Color.orange.opacity(0.2)))
        .help(message)
    }
}

/// Partial transcription display
public struct ChatVoiceTranscript: View {
    public let text: String

    public init(text: String) {
        self.text = text
    }

    public var body: some View {
        if !self.text.isEmpty {
            HStack(spacing: 6) {
                Image(systemName: "waveform")
                    .foregroundStyle(.secondary)
                    .font(.caption)

                Text(self.text)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color.accentColor.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }
}
