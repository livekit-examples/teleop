/** Shown in place of a value: the attribute key(s) the robot didn't set, or set badly. */
export function Missing({ keys, invalid }: { keys: string[]; invalid?: string }) {
  return (
    <span className="fleet-missing" title={invalid ?? 'Participant attribute not set'}>
      <span className="fleet-missing-tag">{invalid ? 'Invalid' : 'Missing'}</span>
      {keys.map((key) => (
        <code key={key}>{key}</code>
      ))}
    </span>
  );
}
