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
import {
    AttachFixtureValidator,
    CreateSessionValidator,
    DeleteSessionValidator,
    DetachFixtureValidator,
    GetSessionValidator,
    SessionController,
    UpdateSessionValidator,
} from "./controller/SessionController";
import {UserRepository} from "./database/repositories/UserRepository";
import {SessionRepository} from "./database/repositories/SessionRepository";
import {SessionFixtureRepository} from "./database/repositories/SessionFixtureRepository";
import {AppDataSource} from "./database/data-source";
import {RateLimitTracker, SportmonksClient} from "./sportmonks";

export class Bootstrap {

    private app: Application = express();
    private logger = new Logger("Bootstrap");
    // Held on the instance so future issues (#5 metrics, #6 fixture poller) can wire them up.
    private rateLimitTracker?: RateLimitTracker;
    private sportmonksClient?: SportmonksClient;

    async setup() {
        this.app.use(cors({
            origin: ["http://localhost:3000", "http://localhost:5173"]
        }));
        this.app.use(express.json());
        this.app.use(fileUpload() as express.RequestHandler);

        // SportMonks integration (ADR 0001). Read config + fail fast when enabled but
        // misconfigured, before touching the database — this is a pure env-var check.
        // The client is held on the instance for use by issues #5/#6; no routes are
        // registered yet.
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

        // Public routes
        const router = new NoAuthRouter(this.app);
        router.post("/auth/login", userController.login, new LoginValidator());

        const sessionRepository = new SessionRepository();
        const sessionFixtureRepository = new SessionFixtureRepository();
        const sessionController = new SessionController(sessionRepository, sessionFixtureRepository);

        // Authenticated routes
        const authRouter = new UserAuthRouter(this.app, publicKey);
        authRouter.get("/users/info", userController.get);

        authRouter.get("/sessions", sessionController.getAll, undefined,
            { resource: 'session', action: 'read' });
        authRouter.get("/sessions/:id", sessionController.get, new GetSessionValidator(),
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

        this.rateLimitTracker = new RateLimitTracker();
        this.sportmonksClient = new SportmonksClient(
            {apiToken, baseUrl},
            this.rateLimitTracker,
        );
        this.logger.info(ctx, "SportMonks client configured", {base_url: baseUrl});
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

        await this.setup();

        this.app.listen(config.port, () => {
            this.logger.info(ctx, "Web server listening on port: " + config.port);
        });
    }
}

interface Config {
    port: number
}
