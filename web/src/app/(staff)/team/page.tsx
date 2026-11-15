import { redirect } from 'next/navigation';

/** The Team page became the admin console. */
export default function TeamMoved() {
  redirect('/admin');
}
