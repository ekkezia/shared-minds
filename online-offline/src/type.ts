export type User = {
  phone_number: number,
  online: boolean,
  last_seen: Date,
  created_at: Date,
  username: string,
};

export type Call = {
  id: string,
  from_number: number,
  to_number: number,
  status: string,
  created_at: Date,
  accepted_at: Date,
  ended_at: Date,
  from_username: string,
  to_username: string,
};
