import { useState } from 'react';
import { Button, Card, Divider, Flex, ProgressBar, Title } from '@tremor/react';
import { Vote } from '../lib/vote-schema';
import clientPromise from '../lib/mongoclient';
import { useWallet } from '@txnlab/use-wallet';
import { BarList } from '@tremor/react';
import { RiCheckboxCircleFill } from '@remixicon/react';
import { all } from 'axios';

const colors = ["green", "blue", "yellow", "pink", "purple"] as const;

export default function AllVotesPage({ votes_data }: { votes_data: Vote[] | null }) {
    const [expandedVotes, setExpandedVotes] = useState<boolean[]>(Array(votes_data?.length).fill(false));

    const toggleVoteDetails = (index: number) => {
        setExpandedVotes(prev => {
            const newState = [...prev];
            newState[index] = !newState[index];
            return newState;
        });
    };

    return (
        <main className="p-4 md:p-10 mx-auto w-full flex flex-col gap-6">
            {votes_data && votes_data.length > 0 ? (
                votes_data.map((vote_data, voteIndex) => {
                    const totalVotes = vote_data?.votes.reduce((acc, vote) => acc + vote.votes, 0);
                    const hasWinner = vote_data?.super_majority ? vote_data?.votes.some(vote => vote.votes > totalVotes! / 2) : !vote_data?.votes.some((vote1, index1) => {
                        return vote_data.votes.some((vote2, index2) => index1 !== index2 && vote1.votes === vote2.votes);
                    });
                    const winnerVote = vote_data?.votes.reduce((prev, current) => (prev.votes > current.votes) ? prev : current);

                    return (
                        <section key={voteIndex} className="border border-gray-300 p-4 rounded-lg w-full">
                            <Button onClick={() => toggleVoteDetails(voteIndex)} className="w-full bg-blue-500 text-white hover:bg-blue-600">
                                <Flex flexDirection='col' justifyContent='between' alignItems='center' className="w-full">
                                    <Title className='text-white w-full text-center break-words whitespace-normal'>{vote_data.title}</Title>
                                    <Flex flexDirection='row' justifyContent='center' alignItems='center' className="w-full">
                                        <RiCheckboxCircleFill className='ml-2' color='#45E881' />
                                        <Title className='text-white break-words whitespace-normal'> Winner: {winnerVote?.description}</Title>
                                    </Flex>
                                </Flex>
                            </Button>
                            <div className={`transition-max-height duration-500 ease-in-out ${expandedVotes[voteIndex] ? 'max-h-[600px] overflow-auto' : 'max-h-0 overflow-hidden'}`}>
                                <Flex flexDirection='col' justifyContent='center' alignItems='center' className="w-full">
                                    <p className="mt-6 mb-10">{vote_data.description}</p>
                                    <span>Started on {new Date(vote_data.createdAt).toLocaleString()} UTC</span>
                                    <span>Closed on {new Date(vote_data.end_date).toLocaleString()} UTC</span>

                                    <Divider />
                                    {vote_data.super_majority && <p className='text-lg font-bold text-red-700 dark:text-dark-tremor-content-strong'>This vote required a super majority: no option passes!</p>}
                                    <Flex className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                                        {vote_data.votes.map((vote, index) => {
                                            const percent = Math.round(((vote.votes / totalVotes!) * 100));
                                            return (
                                                <Card key={index} className={`mt-5 w-full border ${vote.title === winnerVote?.title && hasWinner ? 'border-4 border-green-500' : 'border-gray-300'}`} decorationColor={(vote.title === winnerVote?.title && hasWinner) ? 'green' : 'gray'}>
                                                    <Flex flexDirection='col' justifyContent='center' alignItems='center' className="w-full">
                                                        <Title className="w-full text-center">{vote.title}</Title>
                                                        <p className="text-center">{vote.description}</p>

                                                        <Flex flexDirection='row' justifyContent='between' alignItems='center' className="w-full">
                                                            <span>{vote.votes} votes &bull; {percent ? percent : 0}%</span>
                                                            <span>{totalVotes} votes in total</span>
                                                        </Flex>
                                                        <Flex flexDirection='row' justifyContent='between' alignItems='center' className="w-full">
                                                            <span>{vote.different_people} wallets</span>
                                                            {/*@ts-ignore*/}
                                                            <span>{vote_data.all_people_number} wallets in total</span>
                                                        </Flex>

                                                        <ProgressBar value={percent} color={colors[index]} className="mt-3 w-full" />
                                                    </Flex>
                                                </Card>
                                            );
                                        })}
                                    </Flex>
                                </Flex>
                            </div>
                        </section>
                    );
                })
            ) : <p>No votes found</p>}
        </main>
    );
}

export async function getServerSideProps(context: any) {
    try {
        const client = await clientPromise;
        const db = client.db('main');

        const votes = await db.collection('dao').find({
            current: false,
            deleted: { $ne: true },
            hadVotes: true
        }).sort({ end_date: -1 }).toArray();

        if (!votes || votes.length === 0) {
            return {
                props: { votes_data: null }
            };
        }

        const data = votes.map(vote => {
            const all_people_number = vote.votes.reduce((total: any, vote: { different_people: string | any[]; }) => total + vote.different_people.length, 0);
            console.log(all_people_number);
            return {
                title: vote.title,
                description: vote.description,
                createdAt: vote.createdAt,
                super_majority: vote.super_majority,
                end_date: vote.end_date,
                all_people_number: all_people_number,
                votes: vote.votes.map((vote: any) => ({
                    title: vote.title,
                    description: vote.description,
                    votes: vote.votes,
                    different_people: vote.different_people.length
                }))
            }

        });

        return {
            props: { votes_data: JSON.parse(JSON.stringify(data)) }
        };
    } catch (e) {
        console.error(e);
        return {
            props: { votes_data: null }
        };
    }
}
