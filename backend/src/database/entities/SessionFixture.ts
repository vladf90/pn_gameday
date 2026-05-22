import {
    Entity,
    PrimaryColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
    Index,
    ValueTransformer,
} from "typeorm";
import { Session } from "./Session";

/**
 * Postgres returns `bigint` columns as strings by default to preserve precision.
 * SportMonks fixture IDs comfortably fit within JavaScript's safe integer range
 * (2^53 - 1), so we coerce them to `number` here to keep the public API simple.
 */
const bigintToNumberTransformer: ValueTransformer = {
    to: (value: number | null | undefined): number | null | undefined => value,
    from: (value: string | null | undefined): number | null | undefined => {
        if (value === null || value === undefined) {
            return value as null | undefined;
        }
        return Number(value);
    },
};

@Entity("session_fixture")
@Index(["sportmonksFixtureId"])
export class SessionFixture {
    @PrimaryColumn({ name: "session_id", type: "int" })
    sessionId: number;

    @PrimaryColumn({
        name: "sportmonks_fixture_id",
        type: "bigint",
        transformer: bigintToNumberTransformer,
    })
    sportmonksFixtureId: number;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;

    @ManyToOne(() => Session, { onDelete: "CASCADE" })
    @JoinColumn({ name: "session_id" })
    session: Session;
}
