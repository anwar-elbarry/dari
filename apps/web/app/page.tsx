import { redirect } from 'next/navigation';

/** The signed-in area decides what each role may see; unauthenticated users are sent to /login from there. */
export default function Home() {
  redirect('/dashboard');
}
