import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";

@Entity("user")
@Index(["email"], { unique: true })
@Index(["username"], { unique: true })
export class User {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "varchar", length: 255 })
    username: string;

    @Column({ type: "varchar", length: 255 })
    password: string;

    @Column({ name: "first_name", type: "varchar", length: 255 })
    firstName: string;

    @Column({ name: "last_name", type: "varchar", length: 255 })
    lastName: string;

    @Column({ type: "varchar", length: 255 })
    email: string;

    @Column({ type: "varchar", length: 50, default: 'user' })
    role: string;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at" })
    updatedAt: Date;
}
