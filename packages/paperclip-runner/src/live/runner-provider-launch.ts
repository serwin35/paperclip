import { resolve } from "node:path";
import { codexExecutableReadOnlyRoots } from "../drivers/codex/codex-security-config.js";
import { createIsolatedCodexAppServerArgs } from "../drivers/codex/codex-app-server-driver.js";
import { usesPreconfiguredHome } from "../drivers/preconfigured-home.js";
import { resolveQualifiedAcpxProfile } from "../drivers/acpx/qualified-profiles.js";
import { resolveAcpxProviderMode } from "../drivers/acpx/provider-mode.js";
import type { DurableRecoveryIdentity } from "../contracts/durable-recovery.js";
import type { NativeRuntimeContextSnapshot } from "../contracts/runtime-context.js";
import type { CapabilityRunnerdCodexTransportOptions } from "./runnerd-codex-transport.js";

/** Core's provider inputs. Executable paths and filesystem layout are supplied separately. */
export interface RunnerProviderLaunchRequirements {
  identity: DurableRecoveryIdentity;
  provider: NonNullable<CapabilityRunnerdCodexTransportOptions["provider"]>;
  model: string | null;
  approvalPolicy: "never" | "on-request" | "untrusted";
  readOnly: boolean;
  preparedConversation: boolean;
  includeCollaborationModeInstructions: boolean;
  settings: Pick<CapabilityRunnerdCodexTransportOptions,
    "acpxAgent" | "acpxMode" | "acpxPermissionMode" | "acpxPermissionModePinned" |
    "piThinkingLevel" | "claudeEffort" | "managedProfile" | "agentCoreProfile">;
  instructions: string;
  runtimeContext: NativeRuntimeContextSnapshot | null;
}

/** Locations and provider settings resolved by the built-in execution environment. */
export interface RunnerProviderLaunchEnvironment {
  options: Pick<CapabilityRunnerdCodexTransportOptions,
    "acpxRuntimeDirectory" | "homeMode" | "environment" | "codexArgs" |
    "runnerFilesystemRoot" | "disableCodexProjectInstructions" | "externallySandboxed">;
  root: string;
  cwd: string;
  codexHome: string;
  providerNodeCommand: string;
  codexCommand?: string;
  opencodeProxyPath: string;
  acpxSidecarPath: string;
}

export function createRunnerProviderLaunch(
  requirements: RunnerProviderLaunchRequirements,
  input: RunnerProviderLaunchEnvironment,
): Record<string, unknown> {
  const { identity, instructions: baseInstructions, runtimeContext, settings, provider } = requirements;
  const acpxAgent = provider === "acpx" ? settings.acpxAgent ?? "codex" : null;
  const requestedModel = requirements.model ?? "";
  const includeCodexCollaborationInstructions = provider === "codex" &&
    requirements.includeCollaborationModeInstructions;
  const { codexHome, providerNodeCommand, codexCommand: effectiveCodexCommand,
    opencodeProxyPath, acpxSidecarPath } = input;
  const acpxProfile =
    provider === "acpx"
      ? resolveQualifiedAcpxProfile(acpxAgent!, requestedModel)
      : null;
  const managedProfile = settings.managedProfile;
  const agentCoreProfile = settings.agentCoreProfile;
  if (provider === "claude_managed") {
    if (!managedProfile) {
      throw new Error(
        "Claude Managed runner transport requires a qualified managed profile",
      );
    }
    if (requestedModel !== managedProfile.model) {
      throw new Error(
        "Claude Managed requested model does not match its qualified profile",
      );
    }
  }
  if (provider === "aws_agentcore") {
    if (!agentCoreProfile) {
      throw new Error(
        "AWS AgentCore runner transport requires a qualified AgentCore profile",
      );
    }
    if (requestedModel !== agentCoreProfile.model) {
      throw new Error(
        "AWS AgentCore requested model does not match its qualified profile",
      );
    }
  }
  const selectedAcpxMode = provider === "acpx"
    ? resolveAcpxProviderMode(acpxProfile!.agent, settings.acpxMode) : undefined;
  return provider === "acpx"
          ? {
              kind: "acpx",
              provider: "acpx",
              driver: "acpx_runtime",
              providerVersion: acpxProfile!.acpxVersion,
              agent: acpxProfile!.agent,
              model: requestedModel,
              acpxVersion: acpxProfile!.acpxVersion,
              agentServerPackage: acpxProfile!.agentServerPackage,
              agentServerVersion: acpxProfile!.agentServerVersion,
              agentRuntimePackage: acpxProfile!.agentRuntimePackage,
              agentRuntimeVersion: acpxProfile!.agentRuntimeVersion,
              commandDigest: acpxProfile!.commandDigest,
              sidecarCommand: providerNodeCommand,
              sidecarArgs: [acpxSidecarPath],
              runtimeDirectory:
                input.options.acpxRuntimeDirectory ??
                resolve(input.root, "acpx"),
              normalizedSessionId: identity.normalizedSessionId,
              runId: identity.runId,
              cwd: input.cwd,
              instructions: baseInstructions,
              providerPolicy: { readOnly: requirements.readOnly },
              ...(selectedAcpxMode === undefined ? {} : { mode: selectedAcpxMode }),
              ...(acpxProfile!.agent === "pi" ? { piThinkingLevel: settings.piThinkingLevel } : {}),
              ...(acpxProfile!.agent === "claude" && settings.claudeEffort ? { claudeEffort: settings.claudeEffort } : {}),
              permissionMode: resolveRunnerdAcpxPermissionMode(
                settings.acpxPermissionMode,
              ),
              permissionModePinned:
                settings.acpxPermissionModePinned ?? true,
              runtimeContext,
            }
          : provider === "claude_managed"
            ? {
                kind: "claude_managed",
                model: managedProfile!.model,
                profileId: managedProfile!.profileId,
                anthropicAgentId: managedProfile!.anthropicAgentId,
                agentVersion: managedProfile!.agentVersion,
                environmentId: managedProfile!.environmentId,
                betaVersion: managedProfile!.betaVersion,
                maxSessionListCostUsd: managedProfile!.maxSessionListCostUsd,
                instructions: baseInstructions,
                runtimeContext,
              }
            : provider === "aws_agentcore"
              ? {
                  kind: "aws_agentcore",
                  model: agentCoreProfile!.model,
                  profileId: agentCoreProfile!.profileId,
                  region: agentCoreProfile!.region,
                  accountId: agentCoreProfile!.accountId,
                  harnessArn: agentCoreProfile!.harnessArn,
                  harnessVersion: agentCoreProfile!.harnessVersion,
                  endpointArn: agentCoreProfile!.endpointArn,
                  endpointQualifier: agentCoreProfile!.endpointQualifier,
                  agentRuntimeArn: agentCoreProfile!.agentRuntimeArn,
                  memoryArn: agentCoreProfile!.memoryArn,
                  memoryId: agentCoreProfile!.memoryId,
                  invocationRoleArn: agentCoreProfile!.invocationRoleArn,
                  contextBucket: agentCoreProfile!.contextBucket,
                  contextPrefix: agentCoreProfile!.contextPrefix,
                  contextKmsKeyArn: agentCoreProfile!.contextKmsKeyArn,
                  qualificationRevision:
                    agentCoreProfile!.qualificationRevision,
                  eventExpiryDays: agentCoreProfile!.eventExpiryDays,
                  maxEstimatedSessionCostUsd:
                    agentCoreProfile!.maxEstimatedSessionCostUsd,
                  maxIterations: agentCoreProfile!.maxIterations,
                  maxOutputTokens: agentCoreProfile!.maxOutputTokens,
                  timeoutSeconds: agentCoreProfile!.timeoutSeconds,
                  instructions: baseInstructions,
                  runtimeContext,
                }
              : {
                  kind: provider,
                  provider,
                  ...(input.options.homeMode === "preconfigured" ? { preconfiguredHome: { HOME: input.options.environment!.HOME, CODEX_HOME: codexHome } } : {}),
                  driver:
                    provider === "opencode"
                      ? "opencode_server"
                      : "codex_app_server",
                  providerVersion:
                    provider === "opencode" ? "1.18.34" : "codex-app-server-v1",
                  command:
                    provider === "opencode"
                      ? providerNodeCommand
                      : effectiveCodexCommand!,
                  args:
                    provider === "opencode"
                      ? [opencodeProxyPath]
                      : (input.options.codexArgs ??
                        createRunnerdCodexAppServerArgs({
                          environment: input.options.environment,
                          codexHome,
                          workingDirectory: input.cwd,
                          runtimeStateRoot: input.options.runnerFilesystemRoot ?? input.root,
                          codexCommand: effectiveCodexCommand,
                          instructionWorkingCopyRoot: runtimeContext?.instructions.workingCopy?.rootPath,
                          disableProjectInstructions: input.options.disableCodexProjectInstructions,
                          readOnlyRoots: [
                            ...trustedRuntimeReadOnlyRoots(
                              input.options.environment,
                            ),
                            ...(runtimeContext
                              ? [
                                  resolve(codexHome, "skills"),
                                  runtimeContext.instructions.bundle.rootPath,
                                  ...runtimeContext.skills.map(
                                    (skill) => skill.bundle.rootPath,
                                  ),
                                ]
                              : []),
                          ],
                        })),
                  cwd: input.cwd,
                  model: requirements.model,
                  approvalPolicy:
                    requirements.approvalPolicy,
                  externallySandboxed:
                    provider === "codex" &&
                    input.options.externallySandboxed === true,
                  ...(provider === "codex" && requirements.readOnly ? { readOnly: true } : {}),
                  instructions:
                    provider === "codex"
                      ? withCodexCollaborationRuntimeInstructions(
                          baseInstructions,
                          includeCodexCollaborationInstructions,
                        )
                      : baseInstructions,
                  collaborationMode:
                    requirements.readOnly
                      ? "plan"
                      : "default",
                  ...(requirements.preparedConversation
                    ? { conversationMode: "prepared" }
                    : {}),
                  includeCollaborationModeInstructions:
                    includeCodexCollaborationInstructions,
                  ...(provider === "codex"
                    ? { includeSkillInstructions: runtimeContext !== null }
                    : {}),
                  runtimeContext,
                };
}

const CODEX_COLLABORATION_RUNTIME_INSTRUCTIONS = `## Codex-style collaboration

- Before the first tool call in a turn, send a brief commentary update describing the immediate work you are starting.
- During tool-driven work, send concise commentary updates at meaningful transitions so the user can follow progress without opening raw logs.
- Reserve \`report_progress\` for meaningful durable milestones on longer work. Do not call it merely to create a completion comment on a short run; Paperclip materializes the final assistant response as the durable completion comment.
- Invoke the semantic completion tool exactly once before the final assistant response. After it succeeds, send one self-contained final response with the outcome and verification, then do not call another tool. The completion tool records task disposition; Paperclip keeps receiving your answer until the provider turn ends.`;

export function withCodexCollaborationRuntimeInstructions(
  instructions: string,
  enabled = true,
): string {
  if (!enabled) return instructions;
  const base = instructions.trimEnd();
  return `${base}\n\n${CODEX_COLLABORATION_RUNTIME_INSTRUCTIONS}`;
}

export function resolveRunnerdAcpxPermissionMode(
  configured: CapabilityRunnerdCodexTransportOptions["acpxPermissionMode"],
): NonNullable<CapabilityRunnerdCodexTransportOptions["acpxPermissionMode"]> {
  return configured ?? "approve-all";
}

export function trustedRuntimeReadOnlyRoots(
  environment: NodeJS.ProcessEnv | undefined,
): string[] {
  const path = environment?.PATH ?? "";
  const roots = new Set<string>();
  for (const entry of path.split(process.platform === "win32" ? ";" : ":")) {
    if (entry === "/opt/homebrew" || entry.startsWith("/opt/homebrew/")) {
      roots.add("/opt/homebrew");
    } else if (entry === "/usr/local" || entry.startsWith("/usr/local/")) {
      roots.add("/usr/local");
    } else if (entry === "/opt/local" || entry.startsWith("/opt/local/")) {
      roots.add("/opt/local");
    } else if (entry === "/nix/store" || entry.startsWith("/nix/store/")) {
      roots.add("/nix/store");
    }
  }
  return [...roots];
}

export function createRunnerdCodexAppServerArgs(input: {
  environment: NodeJS.ProcessEnv | undefined;
  codexHome: string;
  codexCommand?: string;
  workingDirectory?: string;
  runtimeStateRoot?: string;
  readOnlyRoots?: string[];
  instructionWorkingCopyRoot?: string;
  disableProjectInstructions?: boolean;
}): string[] {
  // The filesystem policy denies HOME and CODEX_HOME to keep credentials and
  // runner state outside provider reach. Always bind those names to the actual
  // isolated runner home; a stale controller environment must never cause the
  // execution workspace itself to become an explicit deny root.
  const args = [
    ...(input.disableProjectInstructions ? ["-c", "project_doc_max_bytes=0"] : []),
    ...createIsolatedCodexAppServerArgs(
      {
        ...input.environment,
        HOME: usesPreconfiguredHome(input.environment) ? input.environment?.HOME : input.codexHome,
        CODEX_HOME: input.codexHome,
      },
      [...(input.readOnlyRoots ?? []), ...codexExecutableReadOnlyRoots(input.environment ?? {}, input.codexCommand)],
      input.instructionWorkingCopyRoot,
      usesPreconfiguredHome(input.environment) && input.runtimeStateRoot ? [input.runtimeStateRoot] : [],
    ),
  ];
  if (usesPreconfiguredHome(input.environment) && input.workingDirectory) {
    args.unshift("-c", `projects={${JSON.stringify(input.workingDirectory)}={trust_level="trusted"}}`);
  }
  return args;
}
