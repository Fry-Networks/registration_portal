import { Button, Card, Divider, Flex, ProgressBar, Title } from '@tremor/react';
import { Vote } from '../lib/vote-schema';
import clientPromise from '../lib/mongoclient';
import { useState } from 'react';
import ModalVote from '../components/vote';
import { Dialog } from '@tremor/react';
import { useWallet } from '@txnlab/use-wallet';
import { BarList } from '@tremor/react';
const colors = ["green", "blue", "yellow", "pink", "purple"] as const;
export default function LastVotePage({ vote_data }: { vote_data: Vote | null }) {
    const totalVotes = vote_data?.votes.reduce((acc, vote) => acc + vote.votes, 0);
    //check if two options have the same votes
    const hasWinner = vote_data?.super_majority ? vote_data?.votes.some(vote => vote.votes > totalVotes! / 2) : !vote_data?.votes.some((vote1, index1) => {
        return vote_data.votes.some((vote2, index2) => {
            console.log('hey', index1 !== index2 && vote1.votes === vote2.votes)
            return index1 !== index2 && vote1.votes === vote2.votes;
        });
    });
    ;
    const winnerVote = vote_data?.votes.reduce((prev, current) => (prev.votes > current.votes) ? prev : current);
    console.log(typeof vote_data?.createdAt)
    return (
        <main className="p-4 md:p-10 mx-auto max-w-7xl">
            {vote_data !== null ? (
                <Flex flexDirection='col' justifyContent='center' alignItems='center'>

                    <Title>{vote_data.title}</Title>
                    <p className="mb-10">{vote_data.description}</p>
                    <span>
                        Started on {new Date(vote_data.createdAt).toLocaleString()} UTC
                    </span>
                    <span>
                        Closed on {new Date(vote_data.end_date).toLocaleString()} UTC
                    </span>

                    <Divider />
                    {vote_data.super_majority && <p className='text-lg font-bold text-red-700 dark:text-dark-tremor-content-strong'>This vote required a super majority: no option passes!</p>}
                    <Flex className="grid grid-cols-2 gap-4">

                        {vote_data.votes.map((vote, index) => {
                            const percent = Math.round(((vote.votes / totalVotes!) * 100));
                            return (
                                <Card key={index} className={(vote.title === winnerVote?.title && hasWinner) ? 'mt-5 border-4' : 'mt-5'} decorationColor={(vote.title === winnerVote?.title && hasWinner) ? 'green' : 'gray'}>
                                    <Flex flexDirection='col' justifyContent='center' alignItems='center'>
                                        <Title>{vote.title}</Title>
                                        <p>{vote.description}</p>

                                        <Flex flexDirection='row' justifyContent='between' alignItems='center'>
                                            <span>{vote.votes} votes &bull; {percent ? percent : 0}%</span>
                                            <span>{totalVotes} votes in total</span>
                                        </Flex>
                                        <Flex flexDirection='row' justifyContent='between' alignItems='center' className="w-full">
                                            <span>{vote.different_people} wallets</span>
                                            {/*@ts-ignore*/}
                                            <span>{vote_data.all_people_number} wallets in total</span>
                                        </Flex>

                                        <ProgressBar value={percent} color={colors[index]} className="mt-3" />
                                    </Flex>
                                </Card>
                            )
                        })}
                    </Flex>

                </Flex>
            ) : <p>No vote found</p>}
        </main>
    );
}

export async function getServerSideProps(context: any) {
    try {
        const client = await clientPromise;
        const db = client.db('main');

        const vote = (await db.collection('dao').find({
            current: false, deleted: {
                $ne: true

            }, hadVotes: true
        }).sort({ end_date: -1 }).limit(1).toArray())[0]
        if (!vote) {
            return {
                props: { vote_data: null }
            }
        }
        const all_people_number = vote.votes.reduce((total: any, vote: { different_people: string | any[]; }) => total + vote.different_people.length, 0);
        console.log(all_people_number);
        const data = {
            title: vote.title,
            description: vote.description,
            createdAt: vote.createdAt,
            super_majority: vote.super_majority,
            end_date: vote.end_date,
            all_people_number: all_people_number,
            votes: vote.votes.map((vote: any) => {
                return {
                    title: vote.title,
                    description: vote.description,
                    votes: vote.votes,
                    different_people: vote.different_people.length
                }
            }
            )
        }
        return {
            props: { vote_data: JSON.parse(JSON.stringify(data)) }
        };
    } catch (e) {
        console.error(e);
    }
}
