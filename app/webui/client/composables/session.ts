/**
 * Session state — a module-singleton store (no state library needed at this
 * size). Every mount shares the same refs; refresh* re-reads the API and
 * tracks its own settled flag so views can render loading vs empty honestly.
 */
import { reactive, ref } from "vue";
import {
  api,
  type CommandInfo,
  type HistoryEntry,
  type SkillSummary,
  type StatusPayload,
  type ToolSummary,
} from "../lib/api.js";

const status = ref<StatusPayload | null>(null);
const statusError = ref("");
const skills = ref<SkillSummary[]>([]);
const tools = ref<ToolSummary[]>([]);
const history = ref<HistoryEntry[]>([]);
const commands = ref<CommandInfo[]>([]);
const settled = reactive({
  status: false,
  skills: false,
  tools: false,
  history: false,
  commands: false,
});

export function useSession() {
  async function refreshStatus(): Promise<void> {
    try {
      status.value = await api<StatusPayload>("/api/status");
      statusError.value = "";
    } catch (error) {
      statusError.value = (error as Error).message;
    } finally {
      settled.status = true;
    }
  }

  async function refreshSkills(): Promise<void> {
    try {
      skills.value = await api<SkillSummary[]>("/api/skills");
    } catch {
      skills.value = [];
    } finally {
      settled.skills = true;
    }
  }

  async function refreshTools(): Promise<void> {
    try {
      tools.value = await api<ToolSummary[]>("/api/tools");
    } catch {
      tools.value = [];
    } finally {
      settled.tools = true;
    }
  }

  async function refreshHistory(): Promise<void> {
    try {
      history.value = await api<HistoryEntry[]>("/api/history");
    } catch {
      history.value = [];
    } finally {
      settled.history = true;
    }
  }

  async function refreshCommands(): Promise<void> {
    try {
      const payload = await api<{ commands: CommandInfo[] }>("/api/commands");
      commands.value = payload.commands;
    } catch {
      commands.value = [];
    } finally {
      settled.commands = true;
    }
  }

  return {
    status,
    statusError,
    skills,
    tools,
    history,
    commands,
    settled,
    refreshStatus,
    refreshSkills,
    refreshTools,
    refreshHistory,
    refreshCommands,
  };
}
