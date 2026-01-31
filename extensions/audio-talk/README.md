# Audio Talk Extension

Local voice conversation loop for Clawdbot using offline STT (whisper.cpp) and macOS TTS.

## Features

- **Offline Speech-to-Text**: Uses whisper.cpp for local transcription (no cloud API)
- **Multilingual Support**: Default language is Romanian (`ro`), supports all whisper languages
- **Conversation Continuity**: Maintains session context across turns
- **Optional TTS**: macOS `say` command for spoken responses
- **Fixture Mode**: Test with pre-recorded audio files

## Prerequisites

- **macOS** (Apple Silicon recommended)
- **ffmpeg** with avfoundation support (for mic recording)
- **whisper.cpp** binary (for transcription)
- **Whisper GGML model** (multilingual, NOT `.en` variants for non-English)

## Installation

### 1. Install ffmpeg

```bash
brew install ffmpeg
```

### 2. Build whisper.cpp

```bash
# Clone the repository
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp

# Build (creates ./main binary)
make -j

# Optionally, copy to a stable location
cp main /usr/local/bin/whisper-cpp
```

### 3. Download a Whisper Model

**Important**: For non-English languages (like Romanian), use multilingual models (NOT `.en` variants).

```bash
cd whisper.cpp

# Download base model (recommended balance of speed/accuracy)
bash models/download-ggml-model.sh base

# Or download smaller/faster model
bash models/download-ggml-model.sh tiny

# Or download more accurate model (slower)
bash models/download-ggml-model.sh small
```

Move the model to a stable location:

```bash
mkdir -p ~/.cache/clawdbot/models/whisper
cp models/ggml-base.bin ~/.cache/clawdbot/models/whisper/
```

### 4. Enable the Plugin

```bash
# Enable the plugin
clawdbot config set plugins.entries.audio-talk.enabled true

# Configure whisper paths (optional if auto-detected)
clawdbot config set plugins.entries.audio-talk.config.whisper.binaryPath "/usr/local/bin/whisper-cpp"
clawdbot config set plugins.entries.audio-talk.config.whisper.modelPath "~/.cache/clawdbot/models/whisper/ggml-base.bin"

# Set default language (default: ro)
clawdbot config set plugins.entries.audio-talk.config.whisper.language "ro"
```

### 5. Grant Microphone Permission

On first run, macOS will prompt for microphone access. Grant access to Terminal (or your terminal app).

If denied, go to: **System Preferences > Privacy & Security > Microphone** and enable access.

## Usage

### Basic Voice Conversation

```bash
clawdbot talk
```

This starts a loop:
1. "Listening..." - speak into your microphone
2. Press **Enter** to stop recording
3. Transcription appears: "You: [your text]"
4. Assistant responds: "Clawdbot: [response]"
5. Loop continues until **Ctrl+C**

### With TTS (Text-to-Speech)

```bash
clawdbot talk --tts
```

Clawdbot will speak responses using macOS `say` command.

### Single Turn (One-Shot)

```bash
clawdbot talk --one-shot
```

Records one utterance, responds, then exits.

### Fixture Mode (Testing)

Test with a pre-recorded WAV file:

```bash
clawdbot talk --fixture ~/my-recording.wav --one-shot
```

Requirements for WAV file:
- Format: PCM 16-bit
- Sample rate: 16000 Hz
- Channels: Mono (1)

### Continue Existing Session

```bash
clawdbot talk --session my-session-key
```

### Custom Language

```bash
clawdbot talk --lang en  # English
clawdbot talk --lang ro  # Romanian (default)
clawdbot talk --lang auto  # Auto-detect
```

### All Options

```bash
clawdbot talk [options]

Options:
  --fixture <path>      Use pre-recorded WAV instead of microphone
  --model <path>        Whisper model path override
  --lang <code>         Language code (default: ro)
  --tts                 Enable TTS responses
  --no-tts              Disable TTS responses
  --voice <name>        TTS voice name (macOS)
  --agent <id>          Agent ID to use
  --session <key>       Session key to continue conversation
  --one-shot            Single turn only
  --thinking <level>    Thinking level (off, low, medium, high)
  --verbose             Show debug output
```

## Configuration

Configuration lives in `~/.clawdbot/clawdbot.json`:

```json
{
  "plugins": {
    "entries": {
      "audio-talk": {
        "enabled": true,
        "config": {
          "whisper": {
            "binaryPath": "/usr/local/bin/whisper-cpp",
            "modelPath": "~/.cache/clawdbot/models/whisper/ggml-base.bin",
            "language": "ro",
            "threads": 4
          },
          "audio": {
            "ffmpegPath": "ffmpeg",
            "device": ":default",
            "sampleRate": 16000,
            "maxDurationSec": 30
          },
          "tts": {
            "enabled": false,
            "voice": "Samantha"
          },
          "session": {
            "agentId": "default",
            "thinking": "low"
          }
        }
      }
    }
  }
}
```

### Environment Variables

Override config with environment variables:

| Variable | Description |
|----------|-------------|
| `CLAWBOT_WHISPER_BIN` | Path to whisper.cpp binary |
| `CLAWBOT_WHISPER_MODEL` | Path to GGML model file |
| `CLAWBOT_WHISPER_LANG` | Language code |
| `CLAWBOT_TTS_ENABLED` | Enable TTS (`true` or `1`) |
| `CLAWBOT_TTS_VOICE` | TTS voice name |

## Troubleshooting

### "ffmpeg not found"

Install ffmpeg:
```bash
brew install ffmpeg
```

### "whisper binary not found"

Build whisper.cpp:
```bash
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp && make -j
```

Then set the path:
```bash
clawdbot config set plugins.entries.audio-talk.config.whisper.binaryPath "/path/to/whisper.cpp/main"
```

### "whisper model not found"

Download a model:
```bash
cd whisper.cpp
bash models/download-ggml-model.sh base
```

Then set the path:
```bash
clawdbot config set plugins.entries.audio-talk.config.whisper.modelPath "~/.cache/clawdbot/models/whisper/ggml-base.bin"
```

### "No speech detected"

- Speak louder/clearer
- Check microphone permissions
- Verify ffmpeg device: `ffmpeg -f avfoundation -list_devices true -i ""`
- Try specifying device: `clawdbot config set plugins.entries.audio-talk.config.audio.device ":0"`

### Microphone Permission Denied

1. Go to **System Preferences > Privacy & Security > Microphone**
2. Enable access for Terminal (or your terminal app)
3. Restart Terminal

### Poor Transcription Quality

- Use a larger model (`small` instead of `base`)
- Speak more clearly
- Reduce background noise
- Specify the correct language with `--lang`

### TTS Voice Not Found

List available voices:
```bash
say -v '?'
```

Set a valid voice:
```bash
clawdbot config set plugins.entries.audio-talk.config.tts.voice "Alex"
```

### Performance Tips

- Use `tiny` model for faster (but less accurate) transcription
- Increase threads: `clawdbot config set plugins.entries.audio-talk.config.whisper.threads 8`
- Keep recordings short (under 30 seconds)

## Model Recommendations

| Model | Size | Speed | Accuracy | Use Case |
|-------|------|-------|----------|----------|
| `tiny` | ~75MB | Fast | Lower | Quick tests, simple commands |
| `base` | ~142MB | Medium | Good | **Recommended default** |
| `small` | ~466MB | Slower | Better | When accuracy matters |
| `medium` | ~1.5GB | Slow | High | High-quality transcription |

## Development

### Run Tests

```bash
pnpm test extensions/audio-talk
```

### Code Structure

```
extensions/audio-talk/
├── index.ts           # Plugin entry point
├── src/
│   ├── config.ts      # Configuration schema (Zod)
│   ├── cli.ts         # CLI command registration
│   ├── deps.ts        # Dependency checking
│   ├── recorder.ts    # ffmpeg mic recording
│   ├── transcriber.ts # whisper.cpp wrapper
│   ├── speaker.ts     # macOS say TTS
│   ├── loop.ts        # Conversation orchestration
│   └── types.ts       # TypeScript types
└── fixtures/          # Test audio files
```
