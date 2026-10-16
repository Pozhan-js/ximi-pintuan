import { PintuanApp } from '../../../components/pintuan-app';
export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PintuanApp groupId={id} />;
}
