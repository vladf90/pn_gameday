import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    JoinColumn,
} from "typeorm";
import { User } from "./User";

@Entity("session")
export class Session {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "varchar", length: 255 })
    name: string;

    @Column({ name: "user_id", type: "int" })
    userId: number;

    /**
     * Lifecycle marker (ADR 0005). `null` = active; non-null = ended. A partial
     * index on `(user_id) WHERE ended_at IS NULL` makes "list my active
     * sessions" O(active) regardless of the ended-session tail.
     */
    @Column({ name: "ended_at", type: "timestamp", nullable: true })
    endedAt: Date | null;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at" })
    updatedAt: Date;

    @ManyToOne(() => User, { onDelete: "CASCADE" })
    @JoinColumn({ name: "user_id" })
    user: User;
}
