import Foundation
import SwiftUI

#if canImport(AppKit)
import AppKit
#endif

/// Voice settings for chat UI
public struct ChatVoiceSettings: Codable, Equatable, Sendable {
    /// Enable auto-TTS for assistant responses
    public var autoTTS: Bool

    /// TTS voice identifier (macOS voice name)
    public var voiceIdentifier: String?

    /// Speech recognition language (BCP-47 code)
    public var speechLanguage: String

    /// Speaking rate (0.0 to 1.0)
    public var speakingRate: Float

    public init(
        autoTTS: Bool = false,
        voiceIdentifier: String? = nil,
        speechLanguage: String = "ro-RO",
        speakingRate: Float = 0.5
    ) {
        self.autoTTS = autoTTS
        self.voiceIdentifier = voiceIdentifier
        self.speechLanguage = speechLanguage
        self.speakingRate = speakingRate
    }

    public static let `default` = ChatVoiceSettings()
}

/// Available TTS voices on macOS
#if canImport(AppKit)
public struct ChatVoiceOption: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let language: String
    public let isDefault: Bool

    public init(id: String, name: String, language: String, isDefault: Bool = false) {
        self.id = id
        self.name = name
        self.language = language
        self.isDefault = isDefault
    }

    /// Get available system voices
    public static func availableVoices() -> [ChatVoiceOption] {
        var voices: [ChatVoiceOption] = []

        // Use NSSpeechSynthesizer to get available voices
        for voiceId in NSSpeechSynthesizer.availableVoices {
            let attrs = NSSpeechSynthesizer.attributes(forVoice: voiceId)
            let name = attrs[.name] as? String ?? voiceId.rawValue
            let locale = attrs[.localeIdentifier] as? String ?? "en-US"

            voices.append(ChatVoiceOption(
                id: voiceId.rawValue,
                name: name,
                language: locale,
                isDefault: voiceId == NSSpeechSynthesizer.defaultVoice
            ))
        }

        return voices.sorted { $0.name < $1.name }
    }

    /// Get voices for a specific language
    public static func voices(forLanguage languageCode: String) -> [ChatVoiceOption] {
        let all = availableVoices()
        let prefix = languageCode.split(separator: "-").first.map(String.init) ?? languageCode

        return all.filter { voice in
            voice.language.lowercased().hasPrefix(prefix.lowercased())
        }
    }

    /// Get Romanian voices
    public static var romanianVoices: [ChatVoiceOption] {
        voices(forLanguage: "ro")
    }
}
#endif

/// Available speech recognition languages
public struct ChatSpeechLanguageOption: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let nativeName: String

    public init(id: String, name: String, nativeName: String) {
        self.id = id
        self.name = name
        self.nativeName = nativeName
    }

    /// Common speech recognition languages
    public static let commonLanguages: [ChatSpeechLanguageOption] = [
        ChatSpeechLanguageOption(id: "ro-RO", name: "Romanian", nativeName: "Română"),
        ChatSpeechLanguageOption(id: "en-US", name: "English (US)", nativeName: "English"),
        ChatSpeechLanguageOption(id: "en-GB", name: "English (UK)", nativeName: "English"),
        ChatSpeechLanguageOption(id: "de-DE", name: "German", nativeName: "Deutsch"),
        ChatSpeechLanguageOption(id: "fr-FR", name: "French", nativeName: "Français"),
        ChatSpeechLanguageOption(id: "es-ES", name: "Spanish", nativeName: "Español"),
        ChatSpeechLanguageOption(id: "it-IT", name: "Italian", nativeName: "Italiano"),
        ChatSpeechLanguageOption(id: "pt-BR", name: "Portuguese (Brazil)", nativeName: "Português"),
        ChatSpeechLanguageOption(id: "nl-NL", name: "Dutch", nativeName: "Nederlands"),
        ChatSpeechLanguageOption(id: "pl-PL", name: "Polish", nativeName: "Polski"),
        ChatSpeechLanguageOption(id: "ru-RU", name: "Russian", nativeName: "Русский"),
        ChatSpeechLanguageOption(id: "ja-JP", name: "Japanese", nativeName: "日本語"),
        ChatSpeechLanguageOption(id: "ko-KR", name: "Korean", nativeName: "한국어"),
        ChatSpeechLanguageOption(id: "zh-CN", name: "Chinese (Simplified)", nativeName: "简体中文"),
    ]
}

/// Voice settings view for chat
#if canImport(AppKit)
public struct ChatVoiceSettingsView: View {
    @Binding var settings: ChatVoiceSettings
    @State private var availableVoices: [ChatVoiceOption] = []

    public init(settings: Binding<ChatVoiceSettings>) {
        self._settings = settings
    }

    public var body: some View {
        Form {
            Section("Text-to-Speech") {
                Toggle("Auto-speak responses", isOn: self.$settings.autoTTS)
                    .help("Automatically speak assistant responses aloud")

                if self.settings.autoTTS {
                    Picker("Voice", selection: self.$settings.voiceIdentifier) {
                        Text("System Default").tag(nil as String?)
                        ForEach(self.availableVoices) { voice in
                            Text("\(voice.name) (\(voice.language))")
                                .tag(voice.id as String?)
                        }
                    }

                    Slider(value: self.$settings.speakingRate, in: 0.1...1.0) {
                        Text("Speed")
                    }
                    .help("Speaking rate")
                }
            }

            Section("Speech Recognition") {
                Picker("Language", selection: self.$settings.speechLanguage) {
                    ForEach(ChatSpeechLanguageOption.commonLanguages) { lang in
                        Text("\(lang.nativeName) (\(lang.name))")
                            .tag(lang.id)
                    }
                }
                .help("Language for voice recognition")
            }
        }
        .formStyle(.grouped)
        .onAppear {
            self.availableVoices = ChatVoiceOption.availableVoices()
        }
    }
}
#endif

/// Simple TTS speaker using NSSpeechSynthesizer
#if canImport(AppKit)
@MainActor
public final class ChatTTSSpeaker: NSObject, NSSpeechSynthesizerDelegate {
    public static let shared = ChatTTSSpeaker()

    private var synthesizer: NSSpeechSynthesizer?
    private var completion: (() -> Void)?

    public var isSpeaking: Bool {
        self.synthesizer?.isSpeaking ?? false
    }

    public func speak(_ text: String, voiceIdentifier: String? = nil, rate: Float = 0.5) {
        self.stop()

        let synth: NSSpeechSynthesizer
        if let voiceId = voiceIdentifier {
            synth = NSSpeechSynthesizer(voice: NSSpeechSynthesizer.VoiceName(rawValue: voiceId))
                ?? NSSpeechSynthesizer()!
        } else {
            synth = NSSpeechSynthesizer()!
        }

        synth.delegate = self
        synth.rate = 150 + (rate * 150) // Range: 150-300 words per minute
        self.synthesizer = synth

        synth.startSpeaking(text)
    }

    public func stop() {
        self.synthesizer?.stopSpeaking()
        self.synthesizer = nil
        self.completion?()
        self.completion = nil
    }

    public func speakAsync(_ text: String, voiceIdentifier: String? = nil, rate: Float = 0.5) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            self.completion = {
                continuation.resume()
            }
            self.speak(text, voiceIdentifier: voiceIdentifier, rate: rate)
        }
    }

    public nonisolated func speechSynthesizer(
        _ sender: NSSpeechSynthesizer,
        didFinishSpeaking finishedSpeaking: Bool
    ) {
        Task { @MainActor in
            self.completion?()
            self.completion = nil
        }
    }
}
#endif
