import mongoose from "mongoose";

export interface Vote extends mongoose.Document {
    end_date: Date;
    total_votes: number;
    hadVotes: boolean;
    createdAt: string;
    deleted: boolean;
    super_majority: boolean;
    current: boolean
    title: string;
    description: string;
    votes: [
        {
            option: string;
            description: string;
            title: string;
            votes: number;
            different_people: string[];
        }
    ]
    }

export const voteSchema = new mongoose.Schema({
    end_date: Date,
    total_votes: { type: Number, default: 0},
    hadVotes: { type: Boolean, default: false },
    createdAt: { type: String, default: Date.now },
    super_majority: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },
    current: { type: Boolean, default: false },
    title: String,
    description: String,
    votes: [
        {
            option: String,
            description: String,
            title: String,
            votes: { type: Number, default: 0},
            different_people: { type: [String], default: []}
        }
    ]
});
