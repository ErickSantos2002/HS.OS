import {
  BookOpen, Book, FileText, Folder, Briefcase, Rocket, Brain, Wrench,
  Settings, Lightbulb, Target, Users, Database, Code, Layers, Star,
  Heart, Flag, Trophy, Award, Zap, Flame, Sparkles, Sun, Moon, Cloud,
  Globe, Map, MapPin, Compass, Anchor, Plane, Car, Bike,
  Home, Building, Store, Factory, School, Hospital, Landmark, Church,
  Camera, Image, Video, Music, Mic, Headphones, Film, Radio,
  ShoppingCart, ShoppingBag, CreditCard, DollarSign, Wallet, Banknote, Coins, Gift,
  Mail, MessageCircle, Phone, Bell, Send, Inbox, AtSign, Hash,
  Calendar, Clock, Timer, AlarmClock, CheckCircle2, CircleCheck, ListChecks, ClipboardList,
  Cpu, Server, HardDrive, Smartphone, Laptop, Monitor, Keyboard, Mouse,
  Beaker, FlaskConical, Microscope, Atom, Dna, TestTube, Pill, Stethoscope,
  Coffee, Pizza, UtensilsCrossed, Apple, Cake, Cookie, Wine, Beer,
  Leaf, TreePine, Flower, Sprout, Mountain, Waves, Snowflake, Droplet,
  PawPrint, Dog, Cat, Bird, Fish, Bug, Rabbit, Turtle,
  Palette, Brush, Pen, PenTool, Pencil, Eraser, Scissors, Ruler,
  Lock, Unlock, Key, Shield, ShieldCheck, Eye, EyeOff, Fingerprint,
  TrendingUp, TrendingDown, BarChart3, PieChart, LineChart, Activity, Gauge, Crosshair,
  Smile, ThumbsUp, PartyPopper, Crown, Gem, Diamond, Puzzle, Dices,
  type LucideIcon,
} from "lucide-react";

export const SPACE_ICONS: Record<string, LucideIcon> = {
  BookOpen, Book, FileText, Folder, Briefcase, Rocket, Brain, Wrench,
  Settings, Lightbulb, Target, Users, Database, Code, Layers, Star,
  Heart, Flag, Trophy, Award, Zap, Flame, Sparkles, Sun, Moon, Cloud,
  Globe, Map, MapPin, Compass, Anchor, Plane, Car, Bike,
  Home, Building, Store, Factory, School, Hospital, Landmark, Church,
  Camera, Image, Video, Music, Mic, Headphones, Film, Radio,
  ShoppingCart, ShoppingBag, CreditCard, DollarSign, Wallet, Banknote, Coins, Gift,
  Mail, MessageCircle, Phone, Bell, Send, Inbox, AtSign, Hash,
  Calendar, Clock, Timer, AlarmClock, CheckCircle2, CircleCheck, ListChecks, ClipboardList,
  Cpu, Server, HardDrive, Smartphone, Laptop, Monitor, Keyboard, Mouse,
  Beaker, FlaskConical, Microscope, Atom, Dna, TestTube, Pill, Stethoscope,
  Coffee, Pizza, UtensilsCrossed, Apple, Cake, Cookie, Wine, Beer,
  Leaf, TreePine, Flower, Sprout, Mountain, Waves, Snowflake, Droplet,
  PawPrint, Dog, Cat, Bird, Fish, Bug, Rabbit, Turtle,
  Palette, Brush, Pen, PenTool, Pencil, Eraser, Scissors, Ruler,
  Lock, Unlock, Key, Shield, ShieldCheck, Eye, EyeOff, Fingerprint,
  TrendingUp, TrendingDown, BarChart3, PieChart, LineChart, Activity, Gauge, Crosshair,
  Smile, ThumbsUp, PartyPopper, Crown, Gem, Diamond, Puzzle, Dices,
};

export const SPACE_ICON_NAMES = Object.keys(SPACE_ICONS);
export const DEFAULT_SPACE_ICON = "BookOpen";

export function SpaceIcon({
  name,
  className,
  style,
}: { name?: string | null; className?: string; style?: React.CSSProperties }) {
  const Icon = (name && SPACE_ICONS[name]) || SPACE_ICONS[DEFAULT_SPACE_ICON];
  return <Icon className={className} style={style} />;
}
