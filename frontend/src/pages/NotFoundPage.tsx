import { Link } from 'react-router-dom'
import { EmptyState } from '../components/ui/primitives'

export default function NotFoundPage() {
  return (
    <div className="card">
      <EmptyState title="This page doesn’t exist">
        <Link to="/">Return to the overview</Link>
      </EmptyState>
    </div>
  )
}
