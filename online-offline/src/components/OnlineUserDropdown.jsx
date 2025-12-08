// online-offline/src/components/OnlineUserDropdown.jsx

// Helper to format phone number for display
function formatPhoneNumber(number) {
  if (!number) return '';
  const digits = String(number).replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return number;
}

export default function OnlineUserDropdown({
  users = [],
  usersInCall = new Set(),
  userCallPartners = new Map(),
  onPick = (username) => {},
}) {
  return (
    <div class='online-users-dropdown'>
      {users.length === 0 ? (
        <div class='no-online-users'>No users online</div>
      ) : (
        users.map((u) => {
          const isInCall = usersInCall.has(u.phone_number);
          const callPartner = userCallPartners.get(u.phone_number);

          return (
            <div
              class='online-user-item'
              key={u.phone_number || u.username}
              onClick={() => !isInCall && onPick && onPick(u)}
              style={{
                opacity: isInCall ? 0.5 : 1,
                cursor: isInCall ? 'not-allowed' : 'pointer',
                pointerEvents: isInCall ? 'none' : 'auto',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '10px' }}
              >
                <span
                  class='online-indicator'
                  style={{
                    background:
                      u.online === false
                        ? '#aaa'
                        : isInCall
                        ? '#ff9500'
                        : '#34c759',
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div class='online-user-name'>
                    {u.username || 'Unknown'}
                    {isInCall && callPartner && (
                      <span
                        style={{
                          marginLeft: '8px',
                          fontSize: '12px',
                          color: 'rgba(255, 255, 255, 0.6)',
                        }}
                      >
                        (in call with{' '}
                        {callPartner.username ||
                          formatPhoneNumber(callPartner.phoneNumber) ||
                          'someone'}
                        )
                      </span>
                    )}
                    {isInCall && !callPartner && (
                      <span
                        style={{
                          marginLeft: '8px',
                          fontSize: '12px',
                          color: 'rgba(255, 255, 255, 0.6)',
                        }}
                      >
                        (in call)
                      </span>
                    )}
                  </div>
                  <div class='online-user-number'>{u.phone_number || ''}</div>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
