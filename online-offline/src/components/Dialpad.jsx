// src/components/Dialpad.jsx

import { digitToLetters } from '../../utils/digitToLetters';

export default function Dialpad({ onDigit }) {
  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

  return (
    <div class='dialpad'>
      {digits.map((d) => (
        <div class='dial-btn' onClick={() => onDigit && onDigit(d)} key={d}>
          {d}
          {digitToLetters[d] && (
            <span class='letters'>{digitToLetters[d]}</span>
          )}
        </div>
      ))}
    </div>
  );
}
