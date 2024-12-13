import { CheckCircleIcon } from '@heroicons/react/outline';
import { Callout } from '@tremor/react';

export default function MessageUpdate({
  updateSuccess: { status, message }
}: {
  updateSuccess: {
    status?: string;
    message: string;
  };
}) {
  return (
    <>
      {message && status !== 'error' && (
        <Callout
          className="mb-4 mt-4"
          title="Success"
          icon={CheckCircleIcon}
          color="teal"
        >
          Success: {message}
        </Callout>
      )}
      {message && status === 'error' && (
        <Callout
          className="mb-4 mt-4"
          title="Error"
          icon={CheckCircleIcon}
          color="red"
        >
          Error: {message}
        </Callout>
      )}
    </>
  );
}
