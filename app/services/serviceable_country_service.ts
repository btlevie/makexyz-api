import ServiceableCountry from '#models/serviceable_country'

export async function listServiceableCountries(): Promise<ServiceableCountry[]> {
  return ServiceableCountry.query().where('isActive', true).orderBy('countryName')
}

export async function isServiceableCountry(countryCode: string): Promise<boolean> {
  const country = await ServiceableCountry.query()
    .where('countryCode', countryCode)
    .where('isActive', true)
    .first()
  return country !== null
}
