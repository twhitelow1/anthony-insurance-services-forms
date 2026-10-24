# Microsoft 365 single sign-on: setup

Staff who are already signed in to Microsoft 365 in their browser open the admin with no sign-in screen.
Anyone else gets **Sign in with Microsoft** or the email sign-in link.

**Who gets in:** any organisation's Microsoft 365 account (Anthony Insurance, DubLow Digital, or any
other), as long as its email, or its whole domain, is on the **Admins list** in Admin → Settings.
Personal Microsoft accounts (outlook.com, hotmail.com) are refused.

Setup takes about 10 minutes. It can be done in any Microsoft 365 organisation where you can register
apps, for example DubLow's or Anthony's.

## 1. Register the app

Microsoft Entra admin center (entra.microsoft.com) → Applications → App registrations → **New registration**:

- **Name:** Anthony Applications App
- **Supported account types:** **Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)**
- **Redirect URI:** platform **Web**, `https://anthony-insurance-services-forms.vercel.app/api/auth/microsoft/callback`

Click **Register**. Copy the **Application (client) ID** from the Overview page.

## 2. Client secret

Certificates & secrets → **New client secret**, 24 months. Copy the **Value** straight away; it's only shown once.
Put a reminder in the calendar to renew it before it expires.

## 3. Token claims

Token configuration → **Add optional claim** → ID token, then tick **email** and **xms_edov**.
`xms_edov` tells the app whether the account's organisation has verified its email domain, and the app
refuses the sign-in if it hasn't.

API permissions: Microsoft Graph delegated `openid`, `profile`, `email` and `User.Read`. Clicking **Grant admin
consent** here only covers the organisation that registered the app.

## 4. Vercel

Vercel → Settings → Environment Variables, **Production**:

| Variable | Value |
|---|---|
| `AZURE_CLIENT_ID` | Application (client) ID |
| `AZURE_CLIENT_SECRET` | The secret's Value |

Redeploy (or merge the next change) for it to take effect.

## 5. Other organisations

The first time someone from another organisation signs in, Microsoft asks them to accept the app's
sign-in permission (just their name and email). If their organisation blocks users from accepting apps, a
Microsoft 365 admin there accepts it once for everyone with this link:

`https://login.microsoftonline.com/organizations/adminconsent?client_id=<Application (client) ID>`

## 6. Admins list

Admin → Settings → Admins: add each person's email, or a whole domain (e.g. `dublowdigital.com`).
When the list has individual emails, only those emails are let in.

## Troubleshooting

- **"That Microsoft account isn't on the Admins list yet":** add the email in Admin → Settings.
- **"That account isn't allowed":** a personal Microsoft account, or the account has no verified email. Use a work account or the email link.
- **Lands back on the login page with no message:** the browser has no Microsoft session, or more than one account. Click **Sign in with Microsoft** to choose the account.
