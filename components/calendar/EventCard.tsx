import { CalendarEvent } from "@/lib/types";
import { format, parseISO } from "date-fns";

interface EventCardProps {
  event: CalendarEvent;
}

export default function EventCard({ event }: EventCardProps) {
  const formatDate = (iso: string, allDay: boolean) => {
    try {
      return allDay
        ? format(parseISO(iso), "MMM d, yyyy")
        : format(parseISO(iso), "MMM d, h:mm a");
    } catch {
      return iso;
    }
  };

  return (
    <div className="relative bg-slate-800/60 rounded-xl border border-slate-700/60 p-4 hover:border-slate-600 transition-all card-hover overflow-hidden">
      {/* Left accent */}
      <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-emerald-500/60 rounded-full" />

      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100 leading-tight">{event.title}</h3>
        {event.isAllDay && (
          <span className="text-[10px] bg-violet-500/15 text-violet-400 border border-violet-500/30 px-2 py-0.5 rounded-md whitespace-nowrap font-bold uppercase tracking-wider">
            All day
          </span>
        )}
      </div>

      <p className="text-xs text-emerald-400 mt-1.5 font-mono font-medium">
        {formatDate(event.start, event.isAllDay)}
        {!event.isAllDay && event.end && (
          <> – {format(parseISO(event.end), "h:mm a")}</>
        )}
      </p>

      {event.location && (
        <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-1">
          <span>📍</span>
          <span>{event.location}</span>
        </p>
      )}
      {event.description && (
        <p className="text-xs text-slate-600 mt-1.5 line-clamp-2 leading-relaxed">{event.description}</p>
      )}
    </div>
  );
}
