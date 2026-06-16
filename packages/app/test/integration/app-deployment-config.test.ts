import {
  AUTH_AUTHENTIK_PROVIDER_ID,
  AUTH_WEBAUTHN_PROVIDER_ID,
  CHANNEL_CLI_PROVIDER_ID,
  CONNECTOR_CDP_PROVIDER_ID,
  DETECTOR_URL_PROVIDER_ID,
  ENTRYPOINT_NOVNC_PROVIDER_ID,
  LAUNCHER_PROCESS_PROVIDER_ID,
  REFERENCE_PROFILE_LOCAL_DEV_ID,
  SECRET_STORE_REFERENCE_PROVIDER_ID,
  WORKSPACE_PROFILE_PROVIDER_ID,
} from "@gla/provider-set-reference";
import { describe, expect, it } from "vitest";
import {
  createApp,
  referenceProviderSet,
  resolveAppDeploymentConfig,
  resolveCapsuleProviderSelection,
} from "../../src/index.js";

describe("AppDeploymentConfig and capsule provider selection", () => {
  it("exposes app deployment providers without capsule provider fields", () => {
    const deployment = resolveAppDeploymentConfig({
      providerSet: referenceProviderSet,
      providerProfileId: REFERENCE_PROFILE_LOCAL_DEV_ID,
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
      providerSet: referenceProviderSet,
      appDeploymentConfig: { auth: AUTH_AUTHENTIK_PROVIDER_ID },
    });

    expect(capsule).toEqual({
      launcher: LAUNCHER_PROCESS_PROVIDER_ID,
      connector: CONNECTOR_CDP_PROVIDER_ID,
      workspace: WORKSPACE_PROFILE_PROVIDER_ID,
      entrypoint: ENTRYPOINT_NOVNC_PROVIDER_ID,
      detector: DETECTOR_URL_PROVIDER_ID,
    });
    expect(capsule).not.toHaveProperty("auth");
    expect(capsule).not.toHaveProperty("channel");
    expect(capsule).not.toHaveProperty("secretStore");
  });

  it("preserves deployment defaults, provider config, and SecretStore when capsule providers are overridden", () => {
    const opts = {
      providerSet: referenceProviderSet,
      providerProfileId: REFERENCE_PROFILE_LOCAL_DEV_ID,
      capsuleProviders: { detector: DETECTOR_URL_PROVIDER_ID },
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
});
