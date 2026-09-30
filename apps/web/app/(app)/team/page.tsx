'use client';

import { Require } from '../../../components/require';
import { TeamScreen } from '../../../components/team/team-screen';

export default function TeamPage() {
  return (
    <Require capability="team:manage">
      <TeamScreen />
    </Require>
  );
}
