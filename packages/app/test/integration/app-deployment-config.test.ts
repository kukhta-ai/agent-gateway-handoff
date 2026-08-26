import { referenceWpmDependencyBindings } from "@gla/catalog";
import {
  AUTH_AUTHENTIK_PROVIDER_ID,
  AUTH_WEBAUTHN_PROVIDER_ID,
  CHANNEL_CLI_PROVIDER_ID,
  CONNECTOR_CDP_PROVIDER_ID,
  DETECTOR_URL_PROVIDER_ID,
  DETECTOR_USER_DONE_PROVIDER_ID,
  ENTRYPOINT_NOVNC_PROVIDER_ID,
  LAUNCHER_PROCESS_PROVIDER_ID,
  REFERENCE_PROFILE_LOCAL_DEV_ID,
  SECRET_STORE_REFERENCE_PROVIDER_ID,
  WORKSPACE_PROFILE_PROVIDER_ID,
  referenceAppDeploymentConfigForProfile,
  referenceCapsuleProviderSelectionForProfile,
} from "@gla/provider-set-reference";
import { describe, expect, it } from "vitest";
import {
  createApp,
  createBridge,
  createProvisioningBridge,
  resolveAppDeploymentConfig,
  resolveCapsuleProviderSelection,
} from "../../src/index.js";

function referenceSplitOptions(profileId = REFERENCE_PROFILE_LOCAL_DEV_ID) {
  const { providerConfig, ...capsuleProviders } =
    referenceCapsuleProviderSelectionForProfile(profileId);
  return {
    appDeploymentConfig: referenceAppDeploymentConfigForProfile(profileId),
    capsuleProviders,
    ...(providerConfig !== undefined ? { capsuleProviderConfig: providerConfig } : {}),
  };
}

describe("AppDeploymentConfig and capsule provider selection", () => {
  it("exposes app deployment providers without capsule provider fields", () => {
    const deployment = resolveAppDeploymentConfig({
      ...referenceSplitOptions(),
    });

    expect(deployment).toMatchObject({
      auth: AUTH_WEBAUTHN_PROVIDER_ID,
      channel: CHANNEL_CLI_PROVIDER_ID,
      secretStore: SECRET_STORE_REFERENCE_PROVIDER_ID,
      providerConfig: {
        [AUTH_WEBAUTHN_PROVIDER_ID]: expect.objectContaining({
          rpName: "GLA Local Dev",
        }),
        [CHANNEL_CLI_PROVIDER_ID]: expect.objectContaining({
          delivery: "stdout",
          inbound: "memory",
        }),
      },
    });
    expect(deployment).not.toHaveProperty("launcher");
    expect(deployment).not.toHaveProperty("workspace");
    expect(deployment).not.toHaveProperty("entrypoint");
    expect(deployment).not.toHaveProperty("connector");
    expect(deployment).not.toHaveProperty("detector");
  });

  it("exposes capsule providers without app infrastructure provider fields", () => {
    const capsule = resolveCapsuleProviderSelection({
      ...referenceSplitOptions(),
      appDeploymentConfig: {
        ...referenceAppDeploymentConfigForProfile(REFERENCE_PROFILE_LOCAL_DEV_ID),
        auth: AUTH_AUTHENTIK_PROVIDER_ID,
      },
    });

    expect(capsule).toEqual({
      launcher: LAUNCHER_PROCESS_PROVIDER_ID,
      connector: CONNECTOR_CDP_PROVIDER_ID,
      workspace: WORKSPACE_PROFILE_PROVIDER_ID,
      entrypoint: ENTRYPOINT_NOVNC_PROVIDER_ID,
      detector: DETECTOR_USER_DONE_PROVIDER_ID,
    });
    expect(capsule).not.toHaveProperty("auth");
    expect(capsule).not.toHaveProperty("channel");
    expect(capsule).not.toHaveProperty("secretStore");
  });

  it("preserves deployment defaults, provider config, and SecretStore when capsule providers are overridden", () => {
    const splitDefaults = referenceSplitOptions();
    const opts = {
      ...splitDefaults,
      capsuleProviders: {
        ...splitDefaults.capsuleProviders,
        detector: DETECTOR_URL_PROVIDER_ID,
      },
    };

    const deployment = resolveAppDeploymentConfig(opts);
    const capsule = resolveCapsuleProviderSelection(opts);
    const app = createApp(opts);

    expect(deployment.secretStore).toBe(SECRET_STORE_REFERENCE_PROVIDER_ID);
    expect(deployment.providerConfig?.[AUTH_WEBAUTHN_PROVIDER_ID]).toMatchObject({
      rpID: "localhost",
      rpName: "GLA Local Dev",
    });
    expect(capsule.detector).toBe(DETECTOR_URL_PROVIDER_ID);
    expect(app.wiring.auth).toBe("@gla/auth-webauthn");
    expect(app.wiring.secretStore).toBe("@gla/provider-set-reference");
  });

  it("resolves capsule provider defaults through the runtime template package", () => {
    const bridge = createBridge({
      referencePresetId: REFERENCE_PROFILE_LOCAL_DEV_ID,
    });

    expect(bridge.templateShow("browser-handoff").parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          part: "detector",
          provider: DETECTOR_USER_DONE_PROVIDER_ID,
        }),
      ]),
    );
  });

  it("projects split app deployment and capsule overrides into graph metadata", async () => {
    const stack = createProvisioningBridge({
      referencePresetId: REFERENCE_PROFILE_LOCAL_DEV_ID,
      appDeploymentConfig: { auth: AUTH_AUTHENTIK_PROVIDER_ID },
      capsuleProviders: { detector: DETECTOR_URL_PROVIDER_ID },
      dependencyBindings: referenceWpmDependencyBindings(),
    });

    try {
      expect(stack.providerGraphDoctor.selectedProviders).toMatchObject({
        AuthProvider: AUTH_AUTHENTIK_PROVIDER_ID,
        CompletionDetector: DETECTOR_URL_PROVIDER_ID,
      });
      expect(stack.providerGraphDoctor.providers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            providerId: AUTH_AUTHENTIK_PROVIDER_ID,
            selected: true,
            defaultSource: expect.objectContaining({
              source: "base-profile-select",
              providerId: AUTH_AUTHENTIK_PROVIDER_ID,
              profile: "resolved-runtime-selection",
            }),
          }),
          expect.objectContaining({
            providerId: DETECTOR_URL_PROVIDER_ID,
            selected: true,
            defaultSource: expect.objectContaining({
              source: "base-profile-select",
              providerId: DETECTOR_URL_PROVIDER_ID,
              profile: "resolved-runtime-selection",
            }),
          }),
        ]),
      );
    } finally {
      await stack.close();
    }
  });
});
