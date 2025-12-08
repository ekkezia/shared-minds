export default function ActionButtons() {
  return (
    <div class='action-buttons'>
      <button class='call-action-btn cancel-btn'>
        <svg class='icon' viewBox='0 0 24 24'>
          <path
            fill='white'
            d='M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
          />
        </svg>
      </button>

      <button class='call-action-btn call-btn'>
        <svg class='icon' viewBox='0 0 24 24'>
          <path
            fill='white'
            d='M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24...'
          />
        </svg>
      </button>

      <button class='call-action-btn end-btn'>
        <svg class='icon' viewBox='0 0 24 24'>
          <path fill='white' d='M12 9c-1.6 0-3.15.25-4.6.72v3.1...' />
        </svg>
      </button>
    </div>
  );
}
