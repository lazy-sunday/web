import RoomClient from '../../../components/RoomClient';

export const metadata = { title: 'LAZY SUNDAY — Room' };

// Next 15 app router: params is async.
export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <RoomClient code={code.toUpperCase()} />;
}
