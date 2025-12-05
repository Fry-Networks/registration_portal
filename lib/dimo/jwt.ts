import jwt, { JwtHeader, SigningKeyCallback, VerifyErrors } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { getDimoConfig } from './config';

type DecodedDimoJwt = jwt.JwtPayload & {
  sub?: string;
  email?: string;
  wallet?: string;
};

const buildJwksClient = () => {
  const config = getDimoConfig();
  if (!config.jwksUrl) {
    throw new Error('DIMO_JWKS_URL is required to verify DIMO UserJWT tokens.');
  }
  return jwksClient({
    jwksUri: config.jwksUrl,
    cache: true,
    cacheMaxEntries: 5,
    cacheMaxAge: 10 * 60 * 1000 // 10 minutes
  });
};

const getKey = (header: JwtHeader, callback: SigningKeyCallback) => {
  const client = buildJwksClient();
  if (!header.kid) {
    return callback(new Error('No kid in DIMO token header'));
  }
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      return callback(err);
    }
    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
  });
};

/**
 * Verifies a DIMO UserJWT from the hosted Login with DIMO flow.
 * Validates issuer and audience against configured values.
 */
export const verifyDimoUserJwt = async (token: string): Promise<DecodedDimoJwt> => {
  const config = getDimoConfig();
  const expectedIssuer = 'https://auth.dimo.zone';
  const expectedAudience = config.clientId;

  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        algorithms: ['RS256'],
        issuer: expectedIssuer,
        audience: expectedAudience
      },
      (err: VerifyErrors | null, decoded: any) => {
        if (err) {
          return reject(err);
        }
        resolve(decoded as DecodedDimoJwt);
      }
    );
  });
};
