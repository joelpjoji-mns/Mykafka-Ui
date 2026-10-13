import { getResponse, showServerError } from 'lib/errorHandling';
import toast from 'react-hot-toast';

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { custom: jest.fn(), remove: jest.fn() },
}));

describe('Server error normalization', () => {
  it('preserves HTTP status and API messages', async () => {
    const response = new Response(JSON.stringify({ message: 'Read denied' }), {
      status: 403,
      statusText: 'Forbidden',
      headers: { 'content-type': 'application/json' },
    });
    await expect(getResponse(response)).resolves.toMatchObject({
      status: 403,
      statusText: 'Forbidden',
      message: 'Read denied',
    });
  });

  it('keeps already-normalized errors intact', async () => {
    const error = {
      status: 500,
      statusText: 'Internal Server Error',
      message: 'Kafka unavailable',
      url: '/api/messages',
    };
    await expect(getResponse(error)).resolves.toEqual(error);
  });

  it('displays the actual connection failure instead of a generic alert', async () => {
    await showServerError(new Error('Connection closed'));
    const renderAlert = (toast.custom as jest.Mock).mock.calls[0][0];
    expect(renderAlert({ id: 'test' }).props).toMatchObject({
      title: 'Something went wrong',
      message: 'Connection closed',
      type: 'error',
    });
  });
});
