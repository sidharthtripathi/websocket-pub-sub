interface StringObject {
  [key: string]: string;
}
// @ts-ignore
export function parseCookies(request) {
  const list: StringObject = {};
  const cookieHeader = request.headers?.cookie;
  if (!cookieHeader) return list;
  // @ts-ignore
  cookieHeader.split(`;`).forEach(function (cookie) {
    let [name, ...rest] = cookie.split(`=`);
    name = name?.trim();
    if (!name) return;
    const value = rest.join(`=`).trim();
    if (!value) return;
    // @ts-ignore
    list[name] = decodeURIComponent(value);
  });

  return list;
}
