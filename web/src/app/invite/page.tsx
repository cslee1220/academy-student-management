import { Suspense } from "react";

import InviteForm from "./InviteForm";

export default function InvitePage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-lg px-6 py-12 text-slate-500">초대 화면을 준비하는 중...</div>}>
      <InviteForm />
    </Suspense>
  );
}
