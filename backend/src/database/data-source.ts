import "reflect-metadata";
import { DataSource, DataSourceOptions } from "typeorm";
import { SeederOptions } from "typeorm-extension";
import * as dotenv from "dotenv";
import { User } from "./entities/User";
import { Session } from "./entities/Session";
import { SessionFixture } from "./entities/SessionFixture";

dotenv.config({ path: '../.env' });

const environment = process.env.NODE_ENV || 'development';

export const AppDataSource = new DataSource({
    type: (process.env.DB_TYPE as string) || "postgres",
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    synchronize: true,
    logging: environment === 'development',
    entities: [User, Session, SessionFixture],
    migrations: ["src/database/migrations/*.ts"],
    subscribers: ["src/database/subscribers/*.ts"],
    seeds: ["src/database/seeds/**/*.ts"],
    factories: ["src/database/factories/**/*.ts"],
} as DataSourceOptions & SeederOptions);
