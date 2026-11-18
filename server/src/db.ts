/** Cơ sở dữ liệu SQLite một file (node:sqlite có sẵn trong Node 22). Sao lưu = chép file. */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type DB = DatabaseSync

const SCHEMA = `
create table if not exists users (
  id integer primary key, email text unique not null, name text not null default '', pass text not null,
  created integer not null, plan text not null default 'free', plan_until integer,
  tg_chat integer, tg_name text not null default '', link_code text not null
);
create table if not exists sessions (token text primary key, user_id integer not null references users(id) on delete cascade, created integer not null, expires integer not null);
create table if not exists channels (
  id integer primary key, ref text unique not null, kind text not null, title text not null default '', tg_id text,
  status text not null default 'pending', error text not null default '', added integer not null, last_at integer
);
create table if not exists user_channels (
  user_id integer not null references users(id) on delete cascade, channel_id integer not null references channels(id) on delete cascade,
  notify integer not null default 1, added integer not null, primary key (user_id, channel_id)
);
create table if not exists messages (channel_id integer not null references channels(id) on delete cascade, msg_id integer not null, date integer not null, text text not null, primary key (channel_id, msg_id));
create index if not exists messages_date on messages(date);
create table if not exists ai_usage (user_id integer not null, day text not null, calls integer not null default 0, cost real not null default 0, primary key (user_id, day));
create table if not exists chats (id integer primary key, user_id integer not null references users(id) on delete cascade, persona text not null, role text not null, text text not null, at integer not null);
create index if not exists chats_user on chats(user_id, persona, id);
`

export function openDb(dir: string, file = 'golden-duck.db'): DB {
  if (file !== ':memory:') mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(file === ':memory:' ? file : path.join(dir, file))
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on;')
  db.exec(SCHEMA)
  return db
}
