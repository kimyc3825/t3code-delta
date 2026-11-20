// [delta-fix:H2] Usage scans the T3-managed profile of the default Antigravity instance.
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import * as AntigravityUsage from "./AntigravityUsage.ts";

const layer = AntigravityUsage.layer.pipe(
  Layer.provideMerge(
    TestProviderHost.layer().pipe(
      Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
    ),
  ),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

describe("AntigravityUsage", () => {
  it.effect("scans the default instance's managed profile", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const host = yield* ProviderHost.ProviderHost;
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-antigravity-home-" });
      // sha256("antigravity"): the profile T3 creates for the default instance.
      const conversations = path.join(
        host.paths.stateDir,
        "providers",
        "antigravity",
        "ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32",
        "antigravity-acp",
        "conversations",
      );
      yield* fileSystem.makeDirectory(conversations, { recursive: true });
      const usage = yield* AntigravityUsage.AntigravityUsage;
      const scans = yield* usage
        .scan({
          instances: [
            {
              instanceId: ProviderInstanceId.make("antigravity"),
              config: undefined,
              environment: {},
              configured: false,
            },
          ],
          windowStartMs: 0,
        })
        .pipe(Effect.provideService(HostProcess.HomeDirectory, home));
      const scanned = yield* Effect.forEach(scans, (scan) =>
        fileSystem.realPath(scan.dir).pipe(Effect.orElseSucceed(() => scan.dir)),
      );
      const expected = yield* fileSystem.realPath(conversations);
      assert.include(scanned, expected);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );
});
