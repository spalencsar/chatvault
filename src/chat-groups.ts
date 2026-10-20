import type { Chat } from "@/chat-actions";

// Calendar boundaries follow the user's local timezone, including DST changes.
export function groupChatsByDay(chats: Chat[], now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const groups: { today: Chat[]; yesterday: Chat[]; recent: Chat[] } = { today: [], yesterday: [], recent: [] };
  for (const chat of chats) {
    if (chat.lastMs >= today.getTime()) groups.today.push(chat);
    else if (chat.lastMs >= yesterday.getTime()) groups.yesterday.push(chat);
    else groups.recent.push(chat);
  }
  return groups;
}
