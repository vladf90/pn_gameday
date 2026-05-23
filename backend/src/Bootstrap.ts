import * as express from "express";
import * as fileUpload from "express-fileupload";
import * as cors from "cors";
import "reflect-metadata";
import {Application} from "express";
import {Logger} from "./Logger";
import {NoAuthRouter} from "./router/NoAuthRouter";
import {UserAuthRouter} from "./router/UserAuthRouter";
import {Context, ContextFactory} from "./Logger/Context";
import {LoginValidator, UserController} from "./controller/UserController";
import {MetricsController} from "./controller/MetricsController";
import {
    AttachFixtureValidator,
    CreateSessionValidator,
    DeleteSessionValidator,
    DetachFixtureValidator,
    GetLiveSessionValidator,
    GetSessionValidator,
    SessionController,
    UpdateSessionValidator,
} from "./controller/SessionController";
import {FixtureController, GetFixturesByDateValidator} from "./controller/FixtureController";
import {UserRepository} from "./database/repositories/UserRepository";
import {SessionRepository} from "./database/repositories/SessionRepository";
import {SessionFixtureRepository} from "./database/repositories/SessionFixtureRepository";
import {AppDataSource} from "./database/data-source";
import {
    FixturePoller,
    FixturesClient,
    LiveSnapshotStore,
    RateLimitTracker,
    SessionFixtureProvider,
    SportmonksHttpClient,
} from "./sportmonks";

export class Bootstrap {

    private app: Application = express();
    private logger = new Logger("Bootstrap");
    // SportMonks deps — held on the instance so the fixture poller can pick them up
    // once the DB-backed dependencies (provider) are constructed inside `setup()`.
    private rateLimitTracker?: RateLimitTracker;
    private sportmonksClient?: SportmonksHttpClient;
    private liveSnapshotStore?: LiveSnapshotStore;
    // Provider is constructed inside `setup()` once the DB is initialised,
    // because `SessionFixtureRepository` resolves the TypeORM connection eagerly.
    private sessionFixtureProvider?: SessionFixtureProvider;
    private fixturePoller?: FixturePoller;
    // Cached poller options, parsed from env in `configureSportmonks()` so the
    // failure mode for malformed env values lands at boot, not at first tick.
    private pollIntervalMs: number = 5000;
    private multiFixtureBatchSize: number = 50;

    async setup() {
        this.app.use(cors({
            origin: ["http://localhost:3000", "http://localhost:5173"]
        }));
        this.app.use(express.json());
        this.app.use(fileUpload() as express.RequestHandler);

        // SportMonks integration (ADR 0001). Read config + fail fast when enabled but
        // misconfigured, before touching the database — this is a pure env-var check.
        // The client is held on the instance for use by the fixture poller (#6).
        this.configureSportmonks();

        // Initialize TypeORM connection
        await AppDataSource.initialize();

        const userRepository = new UserRepository();

        // Read JWT keys from environment variables
        const privateKeyStr = process.env.JWT_PRIVATE_KEY;
        const publicKeyStr = process.env.JWT_PUBLIC_KEY;

        if (!privateKeyStr || !publicKeyStr) {
            throw new Error("JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be set in environment variables");
        }

        // Decode the keys from base64 as they are base64 encoded in env variables
        const privateKey = Buffer.from(privateKeyStr, 'base64');
        const publicKey = Buffer.from(publicKeyStr, 'base64');

        const userController = new UserController(userRepository, privateKey);
        const metricsController = new MetricsController();

        // Public routes
        const router = new NoAuthRouter(this.app);
        router.post("/auth/login", userController.login, new LoginValidator());

        // Prometheus scrape endpoint. Registered on `NoAuthRouter` so it
        // bypasses JWT auth (scrapers shouldn't manage credentials — protect
        // it at the network layer in production) while still flowing through
        // `BaseRouter` for logging and error handling. The handler returns a
        // `RawResponse`, which `BaseRouter` recognises and dispatches without
        // wrapping in the `{data, code}` JSON envelope (the exposition format
        // is plain-text). See backend/CLAUDE.md "Observability".
        router.get("/metrics", metricsController.handle);

        const sessionRepository = new SessionRepository();
        const sessionFixtureRepository = new SessionFixtureRepository();
        // `liveSnapshotStore` is `undefined` when SportMonks is disabled — the
        // controller treats that case by returning every fixture as missing
        // (see SessionController#getLive).
        const sessionController = new SessionController(
            sessionRepository,
            sessionFixtureRepository,
            this.liveSnapshotStore,
        );

        // Default fixture-selection provider — needs the repository's TypeORM
        // connection, so it's constructed here (after `AppDataSource.initialize()`).
        this.sessionFixtureProvider = new SessionFixtureProvider(sessionFixtureRepository);

        // Authenticated routes
        const authRouter = new UserAuthRouter(this.app, publicKey);
        authRouter.get("/users/info", userController.get);

        // Fixtures-by-day endpoint (ADR 0004 supersedes ADR 0003's public-access
        // decision). Mounted only when the SportMonks integration is enabled —
        // otherwise the route is absent (404), matching how the poller is wired
        // below.
        if (this.sportmonksClient) {
            const fixturesClient = new FixturesClient(this.sportmonksClient);
            const fixtureController = new FixtureController(fixturesClient);
            authRouter.get("/fixtures", fixtureController.getByDate, new GetFixturesByDateValidator(),
                { resource: 'fixture', action: 'read' });
        }

        authRouter.get("/sessions", sessionController.getAll, undefined,
            { resource: 'session', action: 'read' });
        authRouter.get("/sessions/:id", sessionController.get, new GetSessionValidator(),
            { resource: 'session', action: 'read' });
        authRouter.get("/sessions/:id/live", sessionController.getLive, new GetLiveSessionValidator(),
            { resource: 'session', action: 'read' });
        authRouter.post("/sessions", sessionController.create, new CreateSessionValidator(),
            { resource: 'session', action: 'create' });
        authRouter.patch("/sessions/:id", sessionController.update, new UpdateSessionValidator(),
            { resource: 'session', action: 'update' });
        authRouter.delete("/sessions/:id", sessionController.delete, new DeleteSessionValidator(),
            { resource: 'session', action: 'delete' });
        authRouter.post("/sessions/:id/fixtures", sessionController.attachFixture, new AttachFixtureValidator(),
            { resource: 'session', action: 'update' });
        authRouter.delete("/sessions/:id/fixtures/:fixtureId", sessionController.detachFixture, new DetachFixtureValidator(),
            { resource: 'session', action: 'update' });

        // Bring up the SportMonks fixture poller once all its dependencies exist.
        // When `SPORTMONKS_ENABLED=false` the client/store remain undefined and we
        // skip wiring entirely — the integration is a no-op in that mode.
        const ctx = ContextFactory.createProcessContext("sportmonks-poller");
        if (this.sportmonksClient && this.sessionFixtureProvider && this.liveSnapshotStore) {
            const fixturesClient = new FixturesClient(this.sportmonksClient);
            this.fixturePoller = new FixturePoller(
                fixturesClient,
                this.sessionFixtureProvider,
                this.liveSnapshotStore,
                {
                    intervalMs: this.pollIntervalMs,
                    batchSize: this.multiFixtureBatchSize,
                },
            );
            this.fixturePoller.start();
        } else {
            this.logger.info(ctx, "Fixture poller not started — SportMonks integration disabled");
        }
    }

    private configureSportmonks() {
        // Default: enabled. Only the literal string "false" disables it, so a
        // typo can't accidentally turn the integration off in production.
        const enabled = process.env.SPORTMONKS_ENABLED !== "false";
        const ctx = ContextFactory.createProcessContext("sportmonks");
        if (!enabled) {
            this.logger.info(ctx, "SportMonks integration disabled via SPORTMONKS_ENABLED=false");
            return;
        }

        const apiToken = process.env.SPORTMONKS_API_TOKEN;
        if (!apiToken) {
            throw new Error(
                "SPORTMONKS_API_TOKEN must be set when SPORTMONKS_ENABLED is not 'false'. " +
                "Set SPORTMONKS_ENABLED=false to run without the SportMonks integration."
            );
        }

        const baseUrl = process.env.SPORTMONKS_BASE_URL ?? "https://api.sportmonks.com/v3/football";

        this.pollIntervalMs = this.parsePositiveInt(
            process.env.SPORTMONKS_POLL_INTERVAL_MS, 5000, "SPORTMONKS_POLL_INTERVAL_MS",
        );
        this.multiFixtureBatchSize = this.parsePositiveInt(
            process.env.SPORTMONKS_MULTI_FIXTURE_BATCH_SIZE, 50, "SPORTMONKS_MULTI_FIXTURE_BATCH_SIZE",
        );

        this.rateLimitTracker = new RateLimitTracker();
        this.sportmonksClient = new SportmonksHttpClient(
            {apiToken, baseUrl},
            this.rateLimitTracker,
        );
        // Live snapshot store is owned at this scope so the poller (created later
        // in `setup()`, once the DB-backed fixture provider exists) can write into
        // the same instance. The store self-updates the
        // `sportmonks_live_fixtures_in_memory` gauge from `./sportmonks/metrics.ts`.
        this.liveSnapshotStore = new LiveSnapshotStore();
        this.logger.info(ctx, "SportMonks client configured", {
            base_url: baseUrl,
            poll_interval_ms: this.pollIntervalMs,
            batch_size: this.multiFixtureBatchSize,
        });
    }

    /**
     * Parse a positive integer from an env var, falling back to `fallback`
     * when unset and throwing on malformed/non-positive values. Validation
     * here means a misconfigured env crashes at boot instead of at first tick.
     */
    private parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
        if (raw === undefined || raw === "") {
            return fallback;
        }
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            throw new Error(`${name} must be a positive integer (got "${raw}")`);
        }
        return parsed;
    }

    async boot(ctx: Context, config: Config) {
        process.on("uncaughtException", (exception: Error) => {
            this.logger.exception(exception);
            process.exit(1);
        });

        process.on("unhandledRejection", (exception: Error) => {
            this.logger.exception(exception);
            process.exit(1);
        });

        // Graceful SIGTERM: drain the fixture poller's in-flight tick before
        // exit so shutdown is deterministic (ADR 0001 — "Graceful shutdown on
        // SIGTERM drains the in-flight request"). We deliberately do not touch
        // SIGINT here — local dev relies on the default Ctrl+C behaviour.
        process.on("SIGTERM", async () => {
            this.logger.info(ctx, "SIGTERM received — shutting down");
            try {
                await this.fixturePoller?.stop();
            } catch (e) {
                this.logger.exception(e instanceof Error ? e : new Error(String(e)));
            }
            process.exit(0);
        });

        await this.setup();

        this.app.listen(config.port, () => {
            this.logger.info(ctx, "Web server listening on port: " + config.port);
        });
    }
}

interface Config {
    port: number
}
