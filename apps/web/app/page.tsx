import { redirect } from 'next/navigation';

/** The signed-in area decides the landing page per role; unauthenticated users are sent to /login from there. */
export default function Home() {
  redirect('/properties');
}
