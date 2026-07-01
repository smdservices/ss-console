import { describe, expect, it } from 'vitest'
import { inferPostingActorRole } from '../workers/job-monitor/src/qualify'

describe('lead-gen wrong-actor filters', () => {
  it('treats staffing agencies and syndicators as non-direct job actors', () => {
    expect(
      inferPostingActorRole({
        title: 'Operations Manager',
        company_name: 'Robert Half',
        location: 'Tucson, AZ',
        description: 'Placed with our client.',
        job_id: 'job-1',
      })
    ).toBe('staffing_agency')

    expect(
      inferPostingActorRole({
        title: 'Dispatcher',
        company_name: 'Confidential Client',
        location: 'Mesa, AZ',
        description: 'Operations role',
        job_id: 'job-2',
      })
    ).toBe('staffing_agency')

    expect(
      inferPostingActorRole({
        title: 'Office Manager',
        company_name: 'Desert Plumbing',
        location: 'Flagstaff, AZ',
        description: 'Growing team',
        job_id: 'job-3',
        apply_options: [
          { title: 'Apply 1', link: 'https://jobs.example.com/1' },
          { title: 'Apply 2', link: 'https://jobs.example.com/2' },
          { title: 'Apply 3', link: 'https://jobs.example.com/3' },
        ],
      })
    ).toBe('syndicator')
  })
})
