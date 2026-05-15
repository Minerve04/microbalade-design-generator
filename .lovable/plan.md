## Problème
L'URL Google Maps générée utilise `?dirflg=w` (paramètre legacy peu fiable). Google Maps ouvre souvent l'itinéraire en voiture par défaut malgré ce paramètre.

## Solution
Forcer le mode marche côté code (et non côté IA) en utilisant le format officiel de l'API Google Maps Directions :

```
https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=...&destination=...&waypoints=...|...
```

Ce format est documenté par Google et garantit l'ouverture en mode piéton sur web et mobile.

## Changements

**`supabase/functions/generate-balade/index.ts`**

1. Modifier le prompt système : demander à l'IA de retourner un tableau structuré `places` (point de départ + 3 lieux) plutôt qu'une URL Google Maps pré-construite. L'IA est mauvaise pour générer des URLs fiables.

2. Construire l'URL côté serveur après réception de la réponse IA, au format officiel :
   - `origin` = point de départ (encodé)
   - `destination` = point de départ (boucle)
   - `waypoints` = les 3 lieux séparés par `|` (encodés)
   - `travelmode=walking` (forcé)
   - `api=1`

3. Renvoyer au frontend la même structure `{ steps, google_maps_url }` — aucun changement nécessaire côté React.

## Bénéfices
- Mode marche garanti à 100 %
- URL toujours valide (encodage côté serveur, pas côté LLM)
- Logique déterministe, plus de dérive du modèle sur le format d'URL