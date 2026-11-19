import { incomingWritesAllowed } from '../../../packages/school/src/incoming/model.ts';
import { formalooCatchupDue } from '../../../packages/school/src/incoming/digest.ts';
import { syncFormaloo } from '../../../packages/school/src/incoming/formaloo.ts';
export default async function formalooCatchup() {
 if (!incomingWritesAllowed()) return Response.json({skipped:'not-production'});
 if (!formalooCatchupDue()) return Response.json({skipped:'outside-schedule'});
 try {
  const result=await syncFormaloo({full:true});
  return Response.json(result,{status:'error' in result ? 503 : 200});
 } catch { return Response.json({error:'pull-failed'},{status:502}); }
}
export const config = { schedule: '30 11,12 * * *' };
