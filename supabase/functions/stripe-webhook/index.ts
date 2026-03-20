import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  });

  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing stripe-signature', { status: 400 });

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!,
    );
  } catch (err) {
    console.error('Webhook signature error:', err);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.CheckoutSession;
    const userId = session.client_reference_id; // Supabase user UUID

    if (!userId) {
      console.warn('No client_reference_id on session:', session.id);
      return new Response('Missing client_reference_id', { status: 200 });
    }

    const { error } = await supabaseAdmin.from('subscriptions').upsert({
      user_id: userId,
      stripe_customer_id: session.customer as string,
      stripe_subscription_id: session.subscription as string,
      status: 'active',
      updated_at: new Date().toISOString(),
    });

    if (error) console.error('DB upsert error:', error);
    else console.log(`Pro activated for user ${userId}`);
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const { error } = await supabaseAdmin
      .from('subscriptions')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .eq('stripe_customer_id', sub.customer as string);

    if (error) console.error('DB update error:', error);
    else console.log(`Pro cancelled for customer ${sub.customer}`);
  }

  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object as Stripe.Subscription;
    const status = sub.status === 'active' ? 'active' : 'inactive';
    await supabaseAdmin
      .from('subscriptions')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('stripe_customer_id', sub.customer as string);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
