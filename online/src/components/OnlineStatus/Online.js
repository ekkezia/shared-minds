import { OnlineGame } from '../OnlineGame';

const Online = () => {
  return (
    <div className='flex min-h-screen items-center justify-center bg-background'>
      <div className='flex flex-col items-center max-w-2xl w-full px-6'>
        {/* Dino and Arrow */}
        <div className='flex items-center gap-8 mb-8'>
          <div className='relative'>
            <svg
              width='72'
              height='72'
              viewBox='0 0 72 72'
              fill='none'
              className='opacity-50'
            >
              {/* Simplified pixel dino */}
              <rect x='28' y='20' width='16' height='20' fill='#535353' />
              <rect x='36' y='12' width='8' height='12' fill='#535353' />
              <rect x='40' y='16' width='2' height='2' fill='white' />
              <rect x='28' y='40' width='6' height='16' fill='#535353' />
              <rect x='38' y='40' width='6' height='16' fill='#535353' />
            </svg>
          </div>
        </div>

        {/* Error Message */}
        <div className='text-center mb-10'>
          <h1 className='text-3xl font-normal text-foreground mb-6'>
            No internet
          </h1>
          <div className='text-left inline-block'>
            <p className='text-muted-foreground mb-3'>Try:</p>
            <ul className='list-disc list-inside text-muted-foreground space-y-1 ml-2'>
              <li>Checking the network cables, modem, and router</li>
              <li>Reconnecting to Wi-Fi</li>
            </ul>
          </div>
          <p className='text-sm text-muted-foreground mt-6 font-mono'>
            ERR_INTERNET_DISCONNECTED
          </p>
        </div>

        {/* Game */}
        <OnlineGame />
      </div>
    </div>
  );
};

export default Online;
