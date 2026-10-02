import Link from 'next/link'

export default function NotFound() {
  return (
    <>
      <h1>Off the map</h1>
      <p>This path isn&apos;t in the park. <Link href="/">Back to the map</Link>.</p>
    </>
  )
}
