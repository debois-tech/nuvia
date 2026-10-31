'use client';
import { OfficePanel } from '@/components/OfficePanel';
import { RemotePanel } from '@/components/RemotePanel';
import { Shell } from '@/components/Shell';
import { TeamOfficeDay } from '@/components/TeamOfficeDay';
import { isReviewer } from '@/lib/types';

export default function AttendancePage() {
  return (
    <Shell>
      {(me) => (
        <>
          <h1>Attendance</h1>
          {me.role === 'executive' ? null : me.workMode === 'office' ? <OfficePanel /> : <RemotePanel />}
          {isReviewer(me.role) && <TeamOfficeDay />}
        </>
      )}
    </Shell>
  );
}
