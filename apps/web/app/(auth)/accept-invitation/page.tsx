import { AcceptForm } from '../../../components/auth/accept-form';

export default async function AcceptInvitationPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <AcceptForm token={token} />;
}
