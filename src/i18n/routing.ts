import {defineRouting} from 'next-intl/routing';
import {createNavigation} from 'next-intl/navigation';

export const routing = defineRouting({
  locales: ['da'],
  localePrefix: 'as-needed',
  defaultLocale: 'da'
});

export const {Link, redirect, usePathname, useRouter} = createNavigation(routing);
