# Maintainer: Sable Maintainers <https://github.com/SableClient/Sable>

pkgname=sable-nightly-bin
pkgver=1.20.1
pkgrel=1
pkgdesc="An almost stable Matrix client (nightly builds)"
arch=('x86_64')
url="https://github.com/SableClient/Sable"
license=('AGPL-3.0-or-later')
depends=(
  'webkit2gtk-4.1'
  'gtk3'
  'libayatana-appindicator'
  'librsvg'
  'xdotool'
  'hicolor-icon-theme'
  'desktop-file-utils'
)
provides=('sable')
conflicts=('sable' 'sable-bin')
options=('!strip' '!debug')
install=${pkgname}.install
source_x86_64=("${pkgname}_${pkgver}_amd64.deb::${url}/releases/download/nightly/Sable-${pkgver}-linux-x86_64.deb")
sha256sums_x86_64=('SKIP')

package() {
  ar x "${srcdir}/${pkgname}_${pkgver}_amd64.deb" data.tar.xz
  tar -xf data.tar.xz -C "${pkgdir}"
  find "${pkgdir}" -type d -exec chmod 755 {} +
}
