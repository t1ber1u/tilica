import type { ClawdbotPluginApi, ClawdbotPluginDefinition } from "clawdbot/plugin-sdk";
import { audioTalkConfigSchema, type AudioTalkConfig } from "./src/config.js";
import { registerAudioTalkCli } from "./src/cli.js";

const audioTalkPlugin: ClawdbotPluginDefinition = {
  id: "audio-talk",
  name: "Audio Talk",
  description: "Local voice conversation loop using whisper.cpp and macOS say",
  configSchema: audioTalkConfigSchema,
  register(api: ClawdbotPluginApi) {
    const cfg = audioTalkConfigSchema.parse(api.pluginConfig) as AudioTalkConfig;

    if (!cfg.enabled) {
      api.logger.debug("[audio-talk] Plugin disabled via config");
      return;
    }

    api.registerCli(
      ({ program }) => registerAudioTalkCli({ program, config: cfg, logger: api.logger }),
      { commands: ["talk"] },
    );
  },
};

export default audioTalkPlugin;
