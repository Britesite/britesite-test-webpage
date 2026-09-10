/**
 * The script a mirrored page (replicate mode) runs to submit the original's
 * contact form through this site instead of the original CMS. Injected by the
 * mirror route handler only when the captured page carries a form marked
 * `data-mirror-form` at capture. Fields are mapped by type and name heuristics
 * because the original's field names are its own (`form_fields[navn]`); the
 * mapping is visible in the network request, and a wrong guess fails
 * validation loudly rather than sending an empty message.
 */

export const FORM_MESSAGES: Record<string, { success: string; error: string; config: string }> = {
  da: {
    success: "Tak for din henvendelse. Vi vender tilbage hurtigst muligt.",
    error: "Beskeden kunne ikke sendes. Prøv igen, eller kontakt os direkte.",
    config: "Kontaktformularen er ved at blive sat op. Kontakt os venligst direkte.",
  },
  en: {
    success: "Thank you for your message. We will get back to you as soon as possible.",
    error: "The message could not be sent. Please try again or contact us directly.",
    config: "The contact form is being set up. Please contact us directly.",
  },
  de: {
    success: "Vielen Dank für Ihre Nachricht. Wir melden uns so schnell wie möglich.",
    error: "Die Nachricht konnte nicht gesendet werden. Bitte versuchen Sie es erneut oder kontaktieren Sie uns direkt.",
    config: "Das Kontaktformular wird gerade eingerichtet. Bitte kontaktieren Sie uns direkt.",
  },
  sv: {
    success: "Tack för ditt meddelande. Vi återkommer så snart som möjligt.",
    error: "Meddelandet kunde inte skickas. Försök igen eller kontakta oss direkt.",
    config: "Kontaktformuläret håller på att sättas upp. Kontakta oss gärna direkt.",
  },
  nb: {
    success: "Takk for din henvendelse. Vi tar kontakt så snart som mulig.",
    error: "Meldingen kunne ikke sendes. Prøv igjen, eller kontakt oss direkte.",
    config: "Kontaktskjemaet settes opp. Ta gjerne kontakt direkte.",
  },
};

export function formMessagesFor(locale: string) {
  return FORM_MESSAGES[locale.split(/[-_]/)[0].toLowerCase()] ?? FORM_MESSAGES.en;
}

/** Inline `<script>` markup. `successPath` (the original's thank-you page, when
 *  the site has one for this locale) wins over the inline success message. */
export const CONTACT_ENDPOINT = "/api/contact.json";

export function mirrorFormScript({ locale, successPath }: { locale: string; successPath?: string | null }): string {
  const msgs = formMessagesFor(locale);
  const config = JSON.stringify({ successPath: successPath ?? null, msgs, endpoint: CONTACT_ENDPOINT });
  return `<script>(function(){var cfg=${config.replace(/</g, "\\u003c")};
function pick(form){var f={},seen={};var els=form.querySelectorAll("input,textarea,select");
for(var i=0;i<els.length;i++){var el=els[i],t=(el.type||"").toLowerCase(),n=(el.name||"").toLowerCase();
if(t==="hidden"||t==="submit"||t==="button"||!el.name)continue;var v=el.value;
if(t==="email"&&!seen.email){f.email=v;seen.email=1;continue;}
if(t==="tel"&&!seen.phone){f.phone=v;seen.phone=1;continue;}
if(el.tagName==="TEXTAREA"&&!seen.message){f.message=v;seen.message=1;continue;}
if(!seen.name&&(t==="text"||t==="")&&/nav|name|nom|namn/.test(n)){f.name=v;seen.name=1;continue;}
if(!seen.subject&&/subj|emne|ämne|betreff/.test(n)){f.subject=v;seen.subject=1;continue;}
if(!seen.name&&(t==="text"||t==="")){f.name=v;seen.name=1;continue;}
if(!seen.message&&(t==="text"||t==="")){f.message=v;seen.message=1;continue;}}
var hp=form.querySelector('input[name="website"]');f.website=hp?hp.value:"";return f;}
function note(form,text,ok){var n=form.querySelector("[data-mirror-note]");if(!n){n=document.createElement("div");n.setAttribute("data-mirror-note","");n.setAttribute("role","alert");form.appendChild(n);}n.textContent=text;n.style.marginTop="1em";n.style.color=ok?"inherit":"#b00020";}
var forms=document.querySelectorAll("form[data-mirror-form]");
for(var i=0;i<forms.length;i++)(function(form){
var hp=document.createElement("input");hp.type="text";hp.name="website";hp.tabIndex=-1;hp.autocomplete="off";hp.setAttribute("aria-hidden","true");hp.style.cssText="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden;";form.appendChild(hp);
form.addEventListener("submit",function(ev){ev.preventDefault();ev.stopImmediatePropagation();
var btn=form.querySelector('[type="submit"]');if(btn)btn.disabled=true;
fetch(cfg.endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(pick(form))})
.then(function(r){return r.json().catch(function(){return {status:"error",code:"send_failed"};});})
.then(function(res){if(res.status==="success"){if(cfg.successPath){window.location.assign(cfg.successPath);return;}form.reset();note(form,cfg.msgs.success,true);}
else{note(form,res.code==="config_missing"?cfg.msgs.config:cfg.msgs.error,false);if(btn)btn.disabled=false;}})
.catch(function(){note(form,cfg.msgs.error,false);if(btn)btn.disabled=false;});},true);
})(forms[i]);})();</script>`;
}

export function injectMirrorFormScript(html: string, script: string): string {
  if (!/data-mirror-form/.test(html)) return html;
  const i = html.toLowerCase().lastIndexOf("</body>");
  return i === -1 ? html + script : html.slice(0, i) + script + html.slice(i);
}
