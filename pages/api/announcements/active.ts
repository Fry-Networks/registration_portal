import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { ObjectId } from 'mongodb';
import clientPromise from '../../../lib/mongoclient';
import { authOptions } from '../auth/[...nextauth]';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

type AnnouncementResponseItem = {
  id: string;
  title: string;
  body: string;
  variant: 'info' | 'warning' | 'error' | 'success';
  priority: number;
  publishedAt?: string;
  expiresAt?: string;
  cta?: {
    label: string;
    href: string;
  };
};

type ActiveAnnouncementsResponse = {
  announcements: AnnouncementResponseItem[];
  dismissedAnnouncementIds: string[];
};

const COLLECTION_ANNOUNCEMENTS = 'announcements';
const COLLECTION_USERS = 'registration-users';
const ENDPOINT = '/api/announcements/active';

function normalizeVariant(input: unknown): AnnouncementResponseItem['variant'] {
  if (typeof input !== 'string') {
    return 'info';
  }
  const variant = input.toLowerCase();
  if (variant === 'error' || variant === 'success' || variant === 'warning') {
    return variant;
  }
  if (variant === 'critical') {
    return 'error';
  }
  return 'info';
}

function isValidObjectId(value: unknown): value is ObjectId {
  try {
    return Boolean(value && ObjectId.createFromHexString(String(value)));
  } catch (error) {
    return false;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ActiveAnnouncementsResponse | { message: string }>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'That request is not available.',
        'Please access announcements through the dashboard.'
      )
    );
    return;
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.address) {
    res.status(401).json(CommonErrors.noSession());
    return;
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');

    const announcementsCollection = db.collection(COLLECTION_ANNOUNCEMENTS);
    const usersCollection = db.collection(COLLECTION_USERS);

    const now = new Date();

    const announcementDocs = await announcementsCollection
      .find({
        status: 'published',
        $and: [
          {
            $or: [
              { publish_at: { $lte: now } },
              { publish_at: { $exists: false } },
              { publish_at: null }
            ]
          },
          {
            $or: [
              { expires_at: { $gt: now } },
              { expires_at: { $exists: false } },
              { expires_at: null }
            ]
          }
        ]
      })
      .sort({ priority: -1, publish_at: -1, created_at: -1 })
      .limit(20)
      .toArray();

    const announcements: AnnouncementResponseItem[] = announcementDocs.map((doc) => {
      const id = doc._id instanceof ObjectId ? doc._id.toString() : String(doc._id);
      const body = typeof doc.body === 'string' ? doc.body : String(doc.body ?? '');
      const title = typeof doc.title === 'string' ? doc.title : 'Announcement';
      const priority = typeof doc.priority === 'number' ? doc.priority : 0;
      const publishedAt = doc.publish_at instanceof Date ? doc.publish_at : doc.created_at;
      const expiresAt = doc.expires_at instanceof Date ? doc.expires_at : undefined;
      const ctaHref = doc.cta?.href;
      const ctaLabel = doc.cta?.label;

      return {
        id,
        title,
        body,
        priority,
        variant: normalizeVariant(doc.variant),
        publishedAt: publishedAt ? publishedAt.toISOString() : undefined,
        expiresAt: expiresAt ? expiresAt.toISOString() : undefined,
        cta:
          typeof ctaHref === 'string' && ctaHref.length > 0
            ? {
                href: ctaHref,
                label: typeof ctaLabel === 'string' && ctaLabel.length > 0 ? ctaLabel : 'Learn more'
              }
            : undefined
      };
    });

    const userDoc = await usersCollection.findOne(
      { address: session.user.address },
      { projection: { announcement_dismissals: 1 } }
    );

    const dismissedAnnouncementIds = Array.isArray(userDoc?.announcement_dismissals)
      ? userDoc.announcement_dismissals
          .map((entry: any) => {
            if (entry?.id && typeof entry.id === 'string') {
              return entry.id;
            }
            if (entry?._id && isValidObjectId(entry._id)) {
              return entry._id.toString();
            }
            return null;
          })
          .filter((id): id is string => Boolean(id))
      : [];

    res.status(200).json({ announcements, dismissedAnnouncementIds });
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to load announcements',
        'Please refresh the page. If the problem persists, contact support.'
      ),
      walletAddress: session.user.address,
      issueType: 'ANNOUNCEMENTS_FETCH_ERROR',
      part: 'announcements.active.handler',
    });
  }
}
