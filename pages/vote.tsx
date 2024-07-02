import { Button, Card, Divider, Flex, ProgressBar, Title } from '@tremor/react';
import { Vote } from '../lib/vote-schema';
import clientPromise from '../lib/mongoclient';
import { useState } from 'react';
import ModalVote from '../components/vote';
import { Dialog } from '@tremor/react';
import { useWallet } from '@txnlab/use-wallet';
import { BarList } from '@tremor/react';
const colors = ["green", "blue", "yellow", "pink", "purple"] as const;
export default function VotePage({ vote_data }: { vote_data: Vote | null }) {
  const { providers, activeAccount } = useWallet()
  const [openModalId, setOpenModalId] = useState(null as number | null);
  const handleCloseModal = (index: number) => {
    setOpenModalId(null);
  }
  const totalVotes = vote_data?.votes.reduce((acc, vote) => acc + vote.votes, 0);
  return (
    <main className="p-4 md:p-10 mx-auto max-w-7xl">
      {vote_data !== null ? (
        <Flex flexDirection='col' justifyContent='center' alignItems='center'>

          <Title>{vote_data.title}</Title>
          <p className="mb-3">{vote_data.description}</p>
          Will be closed on {new Date(vote_data.end_date).toLocaleString()} UTC
          {vote_data.super_majority && <p className='font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong'>This vote requires a super majority: in order to pass, one option should receive more than half the votes</p>}
          <Divider />
          <Flex className="grid grid-cols-2 gap-4">
            {
              activeAccount ?
                vote_data.votes.map((vote, index) => {
                  const percent = Math.round(((vote.votes / totalVotes!) * 100));
                  return (
                    <Card key={index} className='mt-5'>
                      <Flex flexDirection='col' justifyContent='center' alignItems='center'>
                        <Title>{vote.title}</Title>
                        <p>{vote.description}</p>

                        <Flex flexDirection='row' justifyContent='between' alignItems='center'>
                          <span>{vote.votes} votes &bull; {percent ? percent : 0}%</span>
                          <span>{totalVotes} votes in total</span>
                        </Flex>

                        <ProgressBar value={percent} color={colors[index]} className="mt-3" />
                        <Button className="mt-2" color={colors[index]} size='lg' onClick={() => setOpenModalId(index)}
                        >Vote</Button>
                        <ModalVote key={index} isOpen={openModalId === index}
                          setIsOpen={handleCloseModal} vote={{ index: index, title: vote.title, description: vote.description }} />
                      </Flex>
                    </Card>
                  )
                }) : <p style={{ marginTop: "15px" }}>You need to connect your wallet to vote!</p>
            }
          </Flex>

        </Flex>
      ) : <p>No active vote found</p>}
    </main>
  );
}

export async function getServerSideProps(context: any) {
  try {
    const client = await clientPromise;
    const db = client.db('main');

    const vote = (await db.collection('dao').find({ current: true }).toArray())[0]
    if (!vote) {
      return {
        props: { vote_data: null }
      }
    } else {
      const data = {
        title: vote.title,
        description: vote.description,
        super_majority: vote.super_majority,
        end_date: vote.end_date,
        votes: vote.votes.map((vote: any) => {
          return {
            title: vote.title,
            description: vote.description,
            votes: vote.votes
          }
        }
        )
      }
      return {
        props: { vote_data: JSON.parse(JSON.stringify(data)) }
      };
    }

  } catch (e) {
    console.error(e);
  }
}
